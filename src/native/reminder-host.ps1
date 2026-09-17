param(
  [string]$WorkspacePath = $env:CODEX_TASK_REMINDER_WORKSPACE
)

Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms

if (-not $WorkspacePath) {
  $WorkspacePath = $PSScriptRoot
  while (-not (Test-Path -LiteralPath (Join-Path $WorkspacePath '.codex'))) {
    $parentPath = Split-Path -Parent $WorkspacePath
    if ($parentPath -eq $WorkspacePath) { break }
    $WorkspacePath = $parentPath
  }
}

$eventLogPath = Join-Path $WorkspacePath '.codex\codex-task-reminder\events.ndjson'
$appDataPath = $env:APPDATA
if (-not $appDataPath) { $appDataPath = $WorkspacePath }
$preferencesPath = Join-Path $appDataPath 'CodexTaskReminder\preferences.json'
$diagnosticLogPath = Join-Path $appDataPath 'CodexTaskReminder\host.log'
$script:lastOffset = 0

function Write-Diagnostic($message) {
  $directory = Split-Path -Parent $diagnosticLogPath
  if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
  Add-Content -LiteralPath $diagnosticLogPath -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $message" -Encoding UTF8
}

function Get-Preferences {
  $default = @{ mode = 'light'; soundEnabled = $true }
  try {
    if (Test-Path -LiteralPath $preferencesPath) {
      $saved = Get-Content -LiteralPath $preferencesPath -Raw | ConvertFrom-Json
      if ($saved.mode -in @('light', 'blocking', 'hidden') -and $saved.soundEnabled -is [bool]) {
        return @{ mode = $saved.mode; soundEnabled = $saved.soundEnabled }
      }
    }
  } catch { }
  return $default
}

function Get-Brush([string]$hex) {
  $color = [System.Windows.Media.ColorConverter]::ConvertFromString($hex)
  return New-Object System.Windows.Media.SolidColorBrush($color)
}

function Get-StatusVisuals([string]$status) {
  switch ($status) {
    'completed' {
      return @{
        label         = '任务完成'
        icon          = '✓'
        toneColor     = '#10B981'
        pillBg        = '#2610B981'
        pillBorder    = '#5910B981'
        pillFg        = '#34D399'
        badge         = 'COMPLETED'
        isAutoDismiss = $true
      }
    }
    'needs_input' {
      return @{
        label         = '等待输入'
        icon          = '💬'
        toneColor     = '#F59E0B'
        pillBg        = '#26F59E0B'
        pillBorder    = '#59F59E0B'
        pillFg        = '#FBBF24'
        badge         = 'INPUT REQUIRED'
        isAutoDismiss = $false
      }
    }
    'needs_authorization' {
      return @{
        label         = '等待授权'
        icon          = '🔐'
        toneColor     = '#F59E0B'
        pillBg        = '#26F59E0B'
        pillBorder    = '#59F59E0B'
        pillFg        = '#FBBF24'
        badge         = 'PERMISSION REQUIRED'
        isAutoDismiss = $false
      }
    }
    'failed' {
      return @{
        label         = '执行失败'
        icon          = '✕'
        toneColor     = '#F43F5E'
        pillBg        = '#26F43F5E'
        pillBorder    = '#59F43F5E'
        pillFg        = '#FB7185'
        badge         = 'EXECUTION FAILED'
        isAutoDismiss = $false
      }
    }
    'interrupted' {
      return @{
        label         = '任务中断'
        icon          = '⚠️'
        toneColor     = '#F43F5E'
        pillBg        = '#26F43F5E'
        pillBorder    = '#59F43F5E'
        pillFg        = '#FB7185'
        badge         = 'INTERRUPTED'
        isAutoDismiss = $false
      }
    }
    default {
      return @{
        label         = $status
        icon          = 'ℹ'
        toneColor     = '#3B82F6'
        pillBg        = '#263B82F6'
        pillBorder    = '#593B82F6'
        pillFg        = '#60A5FA'
        badge         = $status.ToUpper()
        isAutoDismiss = $false
      }
    }
  }
}

function Create-StyledButton([string]$text, [string]$bgHex, [string]$borderHex, [string]$fgHex, [int]$cornerRadius, [scriptblock]$action) {
  $btnBorder = New-Object System.Windows.Controls.Border
  $btnBorder.CornerRadius = New-Object System.Windows.CornerRadius($cornerRadius)
  $btnBorder.Background = Get-Brush $bgHex
  $btnBorder.BorderBrush = Get-Brush $borderHex
  $btnBorder.BorderThickness = New-Object System.Windows.Thickness(1)
  $btnBorder.Padding = New-Object System.Windows.Thickness(12, 5, 12, 5)
  $btnBorder.Cursor = [System.Windows.Input.Cursors]::Hand

  $tb = New-Object System.Windows.Controls.TextBlock
  $tb.Text = $text
  $tb.Foreground = Get-Brush $fgHex
  $tb.FontWeight = [System.Windows.FontWeights]::Medium
  $tb.FontSize = 12
  $tb.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
  $tb.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
  $btnBorder.Child = $tb

  $btnBorder.Add_MouseEnter({
    param($s, $e)
    $s.Opacity = 0.82
  })
  $btnBorder.Add_MouseLeave({
    param($s, $e)
    $s.Opacity = 1.0
  })
  $clickHandler = {
    param($s, $e)
    & $action $s
  }.GetNewClosure()
  $btnBorder.Add_MouseLeftButtonDown($clickHandler)

  return $btnBorder
}

function Show-ReminderWindow($eventData) {
  $preferences = Get-Preferences
  if ($preferences.mode -eq 'hidden') { return }
  Write-Diagnostic "显示统一提醒：$($eventData.status) / $($eventData.taskId)"

  $visuals = Get-StatusVisuals $eventData.status

  # 播放声音提示
  if ($preferences.soundEnabled) {
    if ($eventData.status -eq 'completed') {
      [System.Media.SystemSounds]::Asterisk.Play()
    } elseif ($eventData.status -in @('needs_input', 'needs_authorization')) {
      [System.Media.SystemSounds]::Exclamation.Play()
    } else {
      [System.Media.SystemSounds]::Hand.Play()
    }
  }

  $window = New-Object System.Windows.Window
  $window.Title = "Codex 任务提醒 - $($eventData.title)"
  $window.Topmost = $true
  $window.ShowInTaskbar = $false
  $window.WindowStyle = 'None'
  $window.AllowsTransparency = $true

  $handleOpenTask = {
    param($source)
    try {
      [System.Windows.Clipboard]::SetText($eventData.taskId)
    } catch { }
    $targetWindow = if ($source -is [System.Windows.Window]) { $source } else { [System.Windows.Window]::GetWindow($source) }
    if ($targetWindow) { $targetWindow.Close() }
  }.GetNewClosure()

  $handleAcknowledge = {
    param($source)
    $targetWindow = if ($source -is [System.Windows.Window]) { $source } else { [System.Windows.Window]::GetWindow($source) }
    if ($targetWindow) { $targetWindow.Close() }
  }.GetNewClosure()

  # 全局快捷键
  $window.Add_KeyDown({
    param($s, $e)
    if ($e.Key -in @([System.Windows.Input.Key]::Enter, [System.Windows.Input.Key]::Space, [System.Windows.Input.Key]::Escape)) {
      & $handleAcknowledge $s
    } elseif ($e.Key -eq [System.Windows.Input.Key]::O) {
      & $handleOpenTask $s
    }
  })

  # =========================================================================
  # 模式 A：遮挡式全屏模态 (Blocking Modal)
  # =========================================================================
  if ($preferences.mode -eq 'blocking') {
    $window.WindowState = 'Maximized'
    $window.Background = Get-Brush '#D904070E'

    $rootGrid = New-Object System.Windows.Controls.Grid

    $modalCard = New-Object System.Windows.Controls.Border
    $modalCard.Width = 480
    $modalCard.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
    $modalCard.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    $modalCard.CornerRadius = New-Object System.Windows.CornerRadius(20)
    $modalCard.Background = Get-Brush '#161E30'
    $modalCard.BorderBrush = Get-Brush '#253248'
    $modalCard.BorderThickness = New-Object System.Windows.Thickness(1)
    $modalCard.Padding = New-Object System.Windows.Thickness(32, 28, 32, 28)

    $shadow = New-Object System.Windows.Media.Effects.DropShadowEffect
    $shadow.BlurRadius = 45
    $shadow.ShadowDepth = 12
    $shadow.Opacity = 0.85
    $shadow.Color = [System.Windows.Media.ColorConverter]::ConvertFromString('#000000')
    $modalCard.Effect = $shadow

    $stack = New-Object System.Windows.Controls.StackPanel

    # 1. 顶部状态图标光环
    $iconBorder = New-Object System.Windows.Controls.Border
    $iconBorder.Width = 60
    $iconBorder.Height = 60
    $iconBorder.CornerRadius = New-Object System.Windows.CornerRadius(30)
    $iconBorder.Background = Get-Brush $visuals.pillBg
    $iconBorder.BorderBrush = Get-Brush $visuals.pillBorder
    $iconBorder.BorderThickness = New-Object System.Windows.Thickness(1.5)
    $iconBorder.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
    $iconBorder.Margin = New-Object System.Windows.Thickness(0, 0, 0, 14)

    $iconText = New-Object System.Windows.Controls.TextBlock
    $iconText.Text = $visuals.icon
    $iconText.FontSize = 26
    $iconText.Foreground = Get-Brush $visuals.toneColor
    $iconText.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
    $iconText.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    $iconBorder.Child = $iconText
    $stack.Children.Add($iconBorder) | Out-Null

    # 2. 状态药丸标签
    $badgeBorder = New-Object System.Windows.Controls.Border
    $badgeBorder.CornerRadius = New-Object System.Windows.CornerRadius(9999)
    $badgeBorder.Background = Get-Brush $visuals.pillBg
    $badgeBorder.BorderBrush = Get-Brush $visuals.pillBorder
    $badgeBorder.BorderThickness = New-Object System.Windows.Thickness(1)
    $badgeBorder.Padding = New-Object System.Windows.Thickness(12, 4, 12, 4)
    $badgeBorder.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
    $badgeBorder.Margin = New-Object System.Windows.Thickness(0, 0, 0, 14)

    $badgeText = New-Object System.Windows.Controls.TextBlock
    $badgeText.Text = $visuals.badge
    $badgeText.FontSize = 11
    $badgeText.FontWeight = [System.Windows.FontWeights]::Bold
    $badgeText.Foreground = Get-Brush $visuals.pillFg
    $badgeBorder.Child = $badgeText
    $stack.Children.Add($badgeBorder) | Out-Null

    # 3. 标题与摘要
    $titleBlock = New-Object System.Windows.Controls.TextBlock
    $titleBlock.Text = $eventData.title
    $titleBlock.FontSize = 18
    $titleBlock.FontWeight = [System.Windows.FontWeights]::Bold
    $titleBlock.Foreground = Get-Brush '#FFFFFF'
    $titleBlock.TextAlignment = [System.Windows.TextAlignment]::Center
    $titleBlock.TextWrapping = [System.Windows.TextWrapping]::Wrap
    $titleBlock.Margin = New-Object System.Windows.Thickness(0, 0, 0, 8)
    $stack.Children.Add($titleBlock) | Out-Null

    $summaryBlock = New-Object System.Windows.Controls.TextBlock
    $summaryBlock.Text = $eventData.summary
    $summaryBlock.FontSize = 13.5
    $summaryBlock.Foreground = Get-Brush '#94A3B8'
    $summaryBlock.TextAlignment = [System.Windows.TextAlignment]::Center
    $summaryBlock.TextWrapping = [System.Windows.TextWrapping]::Wrap
    $summaryBlock.Margin = New-Object System.Windows.Thickness(0, 0, 0, 16)
    $stack.Children.Add($summaryBlock) | Out-Null

    # 4. Task ID
    $idBorder = New-Object System.Windows.Controls.Border
    $idBorder.CornerRadius = New-Object System.Windows.CornerRadius(6)
    $idBorder.Background = Get-Brush '#0B1120'
    $idBorder.BorderBrush = Get-Brush '#1E293B'
    $idBorder.BorderThickness = New-Object System.Windows.Thickness(1)
    $idBorder.Padding = New-Object System.Windows.Thickness(10, 4, 10, 4)
    $idBorder.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
    $idBorder.Margin = New-Object System.Windows.Thickness(0, 0, 0, 24)

    $idText = New-Object System.Windows.Controls.TextBlock
    $idText.Text = "Task ID: $($eventData.taskId)"
    $idText.FontFamily = New-Object System.Windows.Media.FontFamily('Consolas, Courier New')
    $idText.FontSize = 11
    $idText.Foreground = Get-Brush '#64748B'
    $idBorder.Child = $idText
    $stack.Children.Add($idBorder) | Out-Null

    # 5. 双动作按钮行
    $btnGrid = New-Object System.Windows.Controls.Grid
    $col1 = New-Object System.Windows.Controls.ColumnDefinition
    $col1.Width = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star)
    $col2 = New-Object System.Windows.Controls.ColumnDefinition
    $col2.Width = New-Object System.Windows.GridLength(14, [System.Windows.GridUnitType]::Pixel)
    $col3 = New-Object System.Windows.Controls.ColumnDefinition
    $col3.Width = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star)
    $btnGrid.ColumnDefinitions.Add($col1)
    $btnGrid.ColumnDefinitions.Add($col2)
    $btnGrid.ColumnDefinitions.Add($col3)

    $btnOpen = Create-StyledButton '打开任务 (O)' '#1E293B' '#374151' '#94A3B8' 10 $handleOpenTask
    $btnOpen.Height = 38
    [System.Windows.Controls.Grid]::SetColumn($btnOpen, 0)
    $btnGrid.Children.Add($btnOpen) | Out-Null

    $btnAck = Create-StyledButton '我知道了 (Enter)' $visuals.toneColor $visuals.toneColor '#FFFFFF' 10 $handleAcknowledge
    $btnAck.Height = 38
    [System.Windows.Controls.Grid]::SetColumn($btnAck, 2)
    $btnGrid.Children.Add($btnAck) | Out-Null

    $stack.Children.Add($btnGrid) | Out-Null
    $modalCard.Child = $stack
    $rootGrid.Children.Add($modalCard) | Out-Null
    $window.Content = $rootGrid

  } else {
    # =========================================================================
    # 模式 B：轻提醒悬浮卡片 (Light Toast)
    # =========================================================================
    $cardWidth = 400
    $cardHeight = 180
    $window.Width = $cardWidth + 24
    $window.Height = $cardHeight + 24
    $window.Background = [System.Windows.Media.Brushes]::Transparent

    $area = [System.Windows.SystemParameters]::WorkArea
    $window.Left = $area.Right - $window.Width - 16
    $window.Top = $area.Bottom - $window.Height - 16

    $outerGrid = New-Object System.Windows.Controls.Grid
    $outerGrid.Margin = New-Object System.Windows.Thickness(12)

    $cardBorder = New-Object System.Windows.Controls.Border
    $cardBorder.CornerRadius = New-Object System.Windows.CornerRadius(16)
    $cardBorder.Background = Get-Brush '#111827'
    $cardBorder.BorderBrush = Get-Brush '#253248'
    $cardBorder.BorderThickness = New-Object System.Windows.Thickness(1)
    $cardBorder.ClipToBounds = $true

    $shadow = New-Object System.Windows.Media.Effects.DropShadowEffect
    $shadow.BlurRadius = 24
    $shadow.ShadowDepth = 6
    $shadow.Opacity = 0.75
    $shadow.Color = [System.Windows.Media.ColorConverter]::ConvertFromString('#000000')
    $cardBorder.Effect = $shadow

    # 卡片内部主布局 Grid
    $cardGrid = New-Object System.Windows.Controls.Grid
    $rowMain = New-Object System.Windows.Controls.RowDefinition
    $rowMain.Height = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star)
    $rowProgress = New-Object System.Windows.Controls.RowDefinition
    $rowProgress.Height = New-Object System.Windows.GridLength(3, [System.Windows.GridUnitType]::Pixel)
    $cardGrid.RowDefinitions.Add($rowMain)
    $cardGrid.RowDefinitions.Add($rowProgress)

    # 内部内容容器
    $contentStack = New-Object System.Windows.Controls.StackPanel
    $contentStack.Margin = New-Object System.Windows.Thickness(16, 14, 16, 10)
    [System.Windows.Controls.Grid]::SetRow($contentStack, 0)

    # 1. 顶部行 (状态胶囊 + 时间戳 + 关闭按钮)
    $topDock = New-Object System.Windows.Controls.DockPanel
    $topDock.LastChildFill = $false
    $topDock.Margin = New-Object System.Windows.Thickness(0, 0, 0, 8)

    # 状态药丸
    $pillBorder = New-Object System.Windows.Controls.Border
    $pillBorder.CornerRadius = New-Object System.Windows.CornerRadius(9999)
    $pillBorder.Background = Get-Brush $visuals.pillBg
    $pillBorder.BorderBrush = Get-Brush $visuals.pillBorder
    $pillBorder.BorderThickness = New-Object System.Windows.Thickness(1)
    $pillBorder.Padding = New-Object System.Windows.Thickness(8, 3, 8, 3)
    [System.Windows.Controls.DockPanel]::SetDock($pillBorder, [System.Windows.Controls.Dock]::Left)

    $pillStack = New-Object System.Windows.Controls.StackPanel
    $pillStack.Orientation = [System.Windows.Controls.Orientation]::Horizontal

    $dot = New-Object System.Windows.Shapes.Ellipse
    $dot.Width = 6
    $dot.Height = 6
    $dot.Fill = Get-Brush $visuals.pillFg
    $dot.Margin = New-Object System.Windows.Thickness(0, 0, 6, 0)
    $dot.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    $pillStack.Children.Add($dot) | Out-Null

    $pillText = New-Object System.Windows.Controls.TextBlock
    $pillText.Text = $visuals.label
    $pillText.FontSize = 11
    $pillText.FontWeight = [System.Windows.FontWeights]::SemiBold
    $pillText.Foreground = Get-Brush $visuals.pillFg
    $pillText.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    $pillStack.Children.Add($pillText) | Out-Null

    $pillBorder.Child = $pillStack
    $topDock.Children.Add($pillBorder) | Out-Null

    # 关闭按钮 (✕)
    $closeBtn = New-Object System.Windows.Controls.TextBlock
    $closeBtn.Text = '✕'
    $closeBtn.FontSize = 12
    $closeBtn.Foreground = Get-Brush '#64748B'
    $closeBtn.Cursor = [System.Windows.Input.Cursors]::Hand
    $closeBtn.Padding = New-Object System.Windows.Thickness(4)
    $closeBtn.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    [System.Windows.Controls.DockPanel]::SetDock($closeBtn, [System.Windows.Controls.Dock]::Right)
    $closeBtn.Add_MouseEnter({ param($s, $e) $s.Foreground = Get-Brush '#FFFFFF' })
    $closeBtn.Add_MouseLeave({ param($s, $e) $s.Foreground = Get-Brush '#64748B' })
    $closeBtn.Add_MouseLeftButtonDown({ param($s, $e) [System.Windows.Window]::GetWindow($s).Close() })
    $topDock.Children.Add($closeBtn) | Out-Null

    # 时间戳
    $timeText = New-Object System.Windows.Controls.TextBlock
    $timeText.Text = '刚刚'
    $timeText.FontSize = 11
    $timeText.Foreground = Get-Brush '#64748B'
    $timeText.Margin = New-Object System.Windows.Thickness(0, 0, 10, 0)
    $timeText.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    [System.Windows.Controls.DockPanel]::SetDock($timeText, [System.Windows.Controls.Dock]::Right)
    $topDock.Children.Add($timeText) | Out-Null

    $contentStack.Children.Add($topDock) | Out-Null

    # 2. 标题
    $titleBlock = New-Object System.Windows.Controls.TextBlock
    $titleBlock.Text = $eventData.title
    $titleBlock.FontSize = 14
    $titleBlock.FontWeight = [System.Windows.FontWeights]::SemiBold
    $titleBlock.Foreground = Get-Brush '#FFFFFF'
    $titleBlock.TextTrimming = [System.Windows.TextTrimming]::CharacterEllipsis
    $titleBlock.Margin = New-Object System.Windows.Thickness(0, 0, 0, 3)
    $contentStack.Children.Add($titleBlock) | Out-Null

    # 3. 摘要
    $summaryBlock = New-Object System.Windows.Controls.TextBlock
    $summaryBlock.Text = $eventData.summary
    $summaryBlock.FontSize = 12.5
    $summaryBlock.Foreground = Get-Brush '#94A3B8'
    $summaryBlock.TextWrapping = [System.Windows.TextWrapping]::Wrap
    $summaryBlock.TextTrimming = [System.Windows.TextTrimming]::CharacterEllipsis
    $summaryBlock.MaxHeight = 36
    $summaryBlock.Margin = New-Object System.Windows.Thickness(0, 0, 0, 10)
    $contentStack.Children.Add($summaryBlock) | Out-Null

    # 4. 操作行 (Task ID + 按钮组)
    $actionsDock = New-Object System.Windows.Controls.DockPanel
    $actionsDock.LastChildFill = $false

    $idBorder = New-Object System.Windows.Controls.Border
    $idBorder.CornerRadius = New-Object System.Windows.CornerRadius(4)
    $idBorder.Background = Get-Brush '#0B1120'
    $idBorder.BorderBrush = Get-Brush '#1E293B'
    $idBorder.BorderThickness = New-Object System.Windows.Thickness(1)
    $idBorder.Padding = New-Object System.Windows.Thickness(6, 2, 6, 2)
    $idBorder.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    [System.Windows.Controls.DockPanel]::SetDock($idBorder, [System.Windows.Controls.Dock]::Left)

    $idText = New-Object System.Windows.Controls.TextBlock
    $idText.Text = $eventData.taskId
    $idText.FontFamily = New-Object System.Windows.Media.FontFamily('Consolas, Courier New')
    $idText.FontSize = 11
    $idText.Foreground = Get-Brush '#64748B'
    $idBorder.Child = $idText
    $actionsDock.Children.Add($idBorder) | Out-Null

    # 右侧按钮组
    $btnStack = New-Object System.Windows.Controls.StackPanel
    $btnStack.Orientation = [System.Windows.Controls.Orientation]::Horizontal
    [System.Windows.Controls.DockPanel]::SetDock($btnStack, [System.Windows.Controls.Dock]::Right)

    $btnOpen = Create-StyledButton '打开任务' '#15213D' '#2563EB' '#60A5FA' 6 $handleOpenTask
    $btnOpen.Margin = New-Object System.Windows.Thickness(0, 0, 8, 0)
    $btnStack.Children.Add($btnOpen) | Out-Null

    $btnAck = Create-StyledButton '知道了' '#1E293B' '#374151' '#F8FAFC' 6 $handleAcknowledge
    $btnStack.Children.Add($btnAck) | Out-Null

    $actionsDock.Children.Add($btnStack) | Out-Null
    $contentStack.Children.Add($actionsDock) | Out-Null
    $cardGrid.Children.Add($contentStack) | Out-Null

    # 5. 底部 5 秒倒计时平滑进度条
    if ($visuals.isAutoDismiss) {
      $progressContainer = New-Object System.Windows.Controls.Border
      $progressContainer.Background = Get-Brush '#1A2234'
      [System.Windows.Controls.Grid]::SetRow($progressContainer, 1)

      $progressFill = New-Object System.Windows.Shapes.Rectangle
      $progressFill.Fill = Get-Brush $visuals.toneColor
      $progressFill.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Left
      $progressFill.Width = $cardWidth
      $progressContainer.Child = $progressFill
      $cardGrid.Children.Add($progressContainer) | Out-Null

      # 倒计时平滑驱动与悬停暂停
      $totalDurationMs = 5000
      $remainingMs = 5000
      $tickIntervalMs = 40
      $script:isPaused = $false

      $cardBorder.Add_MouseEnter({
        $script:isPaused = $true
      })
      $cardBorder.Add_MouseLeave({
        $script:isPaused = $false
      })

      $script:activeReminderWindow = $window
      $progressTimer = New-Object System.Windows.Threading.DispatcherTimer
      $progressTimer.Interval = [TimeSpan]::FromMilliseconds($tickIntervalMs)
      $progressTimer.Add_Tick({
        if (-not $script:isPaused) {
          $remainingMs -= $tickIntervalMs
          if ($remainingMs -le 0) {
            $this.Stop()
            if ($script:activeReminderWindow -and $script:activeReminderWindow.IsVisible) {
              $script:activeReminderWindow.Close()
            }
          } else {
            $ratio = [Math]::Max(0, $remainingMs / $totalDurationMs)
            $progressFill.Width = $cardWidth * $ratio
          }
        }
      })
      $progressTimer.Start()
    }

    $cardBorder.Child = $cardGrid
    $outerGrid.Children.Add($cardBorder) | Out-Null
    $window.Content = $outerGrid
  }

  $script:activeReminderWindow = $window
  $window.Show()
}

function Read-NewEvents {
  if (-not (Test-Path -LiteralPath $eventLogPath)) { return }
  $content = Get-Content -LiteralPath $eventLogPath -Raw -Encoding UTF8
  if ($content.Length -lt $script:lastOffset) { $script:lastOffset = 0 }
  $newContent = $content.Substring($script:lastOffset)
  $script:lastOffset = $content.Length
  foreach ($line in ($newContent -split "`r?`n")) {
    if (-not $line.Trim()) { continue }
    try {
      $eventData = $line | ConvertFrom-Json
      if ($eventData.taskId -and $eventData.title -and $eventData.status -and $eventData.occurredAt) {
        Show-ReminderWindow $eventData
      }
    } catch {
      Write-Diagnostic "事件处理失败：$($_.Exception.Message)"
    }
  }
}

if ($MyInvocation.InvocationName -ne '.' -and -not $env:TEST_REMINDER_HOST_NO_RUN) {
  if (Test-Path -LiteralPath $eventLogPath) {
    $script:lastOffset = (Get-Content -LiteralPath $eventLogPath -Raw -Encoding UTF8).Length
  }

  $timer = New-Object System.Windows.Threading.DispatcherTimer
  $timer.Interval = [TimeSpan]::FromMilliseconds(500)
  $timer.Add_Tick({ Read-NewEvents })
  $timer.Start()
  Write-Diagnostic "原生提醒宿主已启动 (统一现代 UI)，监听：$eventLogPath"
  [System.Windows.Threading.Dispatcher]::Run()
}
