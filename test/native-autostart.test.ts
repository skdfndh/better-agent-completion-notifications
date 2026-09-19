import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectPath = process.cwd();
const installScript = join(projectPath, "src", "native", "install-autostart.ps1");
const supervisorScript = join(projectPath, "src", "native", "reminder-supervisor.ps1");
const watchdogScript = join(projectPath, "src", "native", "reminder-watchdog.ps1");
const reminderHostScript = join(projectPath, "src", "native", "reminder-host.ps1");
const hostLauncherScript = join(projectPath, "src", "native", "reminder-host-launcher.ps1");
const desktopHostSupervisorScript = join(projectPath, "src", "native", "reminder-desktop-host-supervisor.ps1");
const hiddenLauncherScript = join(projectPath, "src", "native", "reminder-hidden-launcher.vbs");
const sessionStartScript = join(projectPath, "src", "native", "reminder-session-start.ps1");
const sessionLifecycleInstallerScript = join(projectPath, "src", "native", "install-session-lifecycle.ps1");
const uninstallAutostartScript = join(projectPath, "src", "native", "uninstall-autostart.ps1");
const agentConfigScript = join(projectPath, "src", "native", "agent-config.ps1");

function toPowerShellLiteral(value: string) {
  return value.replaceAll("'", "''");
}

async function runPowerShell(command: string) {
  return execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    windowsHide: true,
  });
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("等待监督器重启守护器超时");
}

test("安装脚本创建可重启的登录守护任务", async () => {
  const taskName = `CodexTaskReminderWatchdog-Test-${randomUUID()}`;
  const escapedInstallScript = toPowerShellLiteral(installScript);
  const escapedProjectPath = toPowerShellLiteral(projectPath);

  try {
    const { stdout } = await runPowerShell(`
      $ErrorActionPreference = 'Stop'
      & '${escapedInstallScript}' -WorkspacePath '${escapedProjectPath}' -TaskName '${taskName}' -SkipShortcuts -SkipStart
      $task = Get-ScheduledTask -TaskName '${taskName}'
      $recoveryTrigger = @($task.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskTimeTrigger' }) | Select-Object -First 1
      [PSCustomObject]@{
        hasLogonTrigger = @($task.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' }).Count -eq 1
        hasRecoveryTrigger = $null -ne $recoveryTrigger
        recoveryInterval = if ($recoveryTrigger) { [string]$recoveryTrigger.Repetition.Interval } else { $null }
        restartCount = [int]$task.Settings.RestartCount
        restartInterval = [string]$task.Settings.RestartInterval
        execute = [string]$task.Actions[0].Execute
        arguments = [string]$task.Actions[0].Arguments
      } | ConvertTo-Json -Compress -Depth 10
    `);
    const task = JSON.parse(stdout.trim());

    assert.equal(task.hasLogonTrigger, true);
    assert.equal(task.hasRecoveryTrigger, true);
    assert.equal(task.recoveryInterval, "PT1M");
    assert.equal(task.restartCount, 3);
    assert.equal(task.restartInterval, "PT1M");
    assert.match(task.execute, /wscript\.exe$/i);
    assert.match(task.arguments, /reminder-hidden-launcher\.vbs/);
    assert.match(task.arguments, /reminder-supervisor\.ps1/);
    assert.match(task.arguments, /-DisableNativeHost/);
  } finally {
    await runPowerShell(`
      Stop-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName '${taskName}' -Confirm:$false -ErrorAction SilentlyContinue
      exit 0
    `);
  }
});

test("监督器在守护器退出后重新启动它", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-task-reminder-supervisor-"));
  const workerScript = join(directory, "test-watchdog.ps1");
  const startsPath = join(directory, "starts.log");
  await writeFile(
    workerScript,
    "param([string]$WorkspacePath)\nAdd-Content -LiteralPath (Join-Path $WorkspacePath 'starts.log') 'started'\n",
    "utf8",
  );
  const supervisor = spawn(
    "powershell.exe",
    ["-NoProfile", "-File", supervisorScript, "-WatchdogScript", workerScript, "-WorkspacePath", directory, "-RestartDelaySeconds", "1"],
    { windowsHide: true },
  );

  try {
    await waitFor(async () => {
      try {
        return (await readFile(startsPath, "utf8")).trim().split("\n").length >= 2;
      } catch {
        return false;
      }
    }, 5_000);
    const starts = (await readFile(startsPath, "utf8")).trim().split("\n");
    assert.ok(starts.length >= 2);
  } finally {
    supervisor.kill();
    await rm(directory, { recursive: true, force: true });
  }
});

test("监督器启动时接管已有的守护器", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-task-reminder-supervisor-adopt-"));
  const workerScript = join(directory, "managed-watchdog.ps1");
  await writeFile(workerScript, "Start-Sleep -Seconds 10\n", "utf8");
  const worker = spawn("powershell.exe", ["-NoProfile", "-File", workerScript], { windowsHide: true });
  const escapedSupervisorScript = toPowerShellLiteral(supervisorScript);
  const escapedWorkerScript = toPowerShellLiteral(workerScript);

  try {
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    const { stdout } = await runPowerShell(`
      $env:TEST_REMINDER_SUPERVISOR_NO_RUN = '1'
      . '${escapedSupervisorScript}'
      (Get-ManagedProcess -ScriptPath '${escapedWorkerScript}').Id
    `);
    assert.equal(Number(stdout.trim()), worker.pid);
  } finally {
    worker.kill();
    await rm(directory, { recursive: true, force: true });
  }
});

test("守护器启动时接管已有的受管进程", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-task-reminder-adopt-"));
  const workerScript = join(directory, "managed-worker.ps1");
  await writeFile(workerScript, "Start-Sleep -Seconds 10\n", "utf8");
  const worker = spawn("powershell.exe", ["-NoProfile", "-File", workerScript], { windowsHide: true });
  const escapedWatchdogScript = toPowerShellLiteral(watchdogScript);
  const escapedWorkerScript = toPowerShellLiteral(workerScript);

  try {
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    const { stdout } = await runPowerShell(`
      $env:TEST_REMINDER_WATCHDOG_NO_RUN = '1'
      . '${escapedWatchdogScript}'
      (Get-ManagedProcess -ScriptPath '${escapedWorkerScript}').Id
    `);
    assert.equal(Number(stdout.trim()), worker.pid);
  } finally {
    worker.kill();
    await rm(directory, { recursive: true, force: true });
  }
});

test("正式宿主启动器会清除遗留的测试开关", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-task-reminder-host-launcher-"));
  const workerScript = join(directory, "test-host.ps1");
  const markerPath = join(directory, "started.txt");
  await writeFile(
    workerScript,
    "param([string]$WorkspacePath)\nif ($env:TEST_REMINDER_HOST_NO_RUN) { exit 7 }\nSet-Content -LiteralPath (Join-Path $WorkspacePath 'started.txt') -Value 'started'\n",
    "utf8",
  );
  const escapedLauncherScript = toPowerShellLiteral(hostLauncherScript);
  const escapedWorkerScript = toPowerShellLiteral(workerScript);
  const escapedDirectory = toPowerShellLiteral(directory);

  try {
    await runPowerShell(`
    $env:TEST_REMINDER_HOST_NO_RUN = '1'
    & '${escapedLauncherScript}' -WorkspacePath '${escapedDirectory}' -HostScript '${escapedWorkerScript}'
    `);
    assert.equal((await readFile(markerPath, "utf8")).trim(), "started");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("正式宿主启动器在独立进程中运行宿主", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-task-reminder-host-process-"));
  const workerScript = join(directory, "test-host.ps1");
  const markerPath = join(directory, "host-pid.txt");
  await writeFile(
    workerScript,
    "param([string]$WorkspacePath)\nSet-Content -LiteralPath (Join-Path $WorkspacePath 'host-pid.txt') -Value $PID\n",
    "utf8",
  );
  const launcher = spawn(
    "powershell.exe",
    ["-NoProfile", "-File", hostLauncherScript, "-WorkspacePath", directory, "-HostScript", workerScript],
    { env: { ...process.env, TEST_REMINDER_HOST_NO_RUN: "1" }, windowsHide: true },
  );

  try {
    await new Promise<void>((resolveExit, rejectExit) => {
      launcher.once("error", rejectExit);
      launcher.once("exit", (code) => (code === 0 ? resolveExit() : rejectExit(new Error(`启动器退出码：${code}`))));
    });
    assert.notEqual(Number((await readFile(markerPath, "utf8")).trim()), launcher.pid);
  } finally {
    launcher.kill();
    await rm(directory, { recursive: true, force: true });
  }
});

test("正式宿主启动器将指定的应用数据目录传给宿主", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-task-reminder-host-appdata-"));
  const workerScript = join(directory, "test-host.ps1");
  const markerPath = join(directory, "appdata.txt");
  await writeFile(
    workerScript,
    "param([string]$WorkspacePath)\nSet-Content -LiteralPath (Join-Path $WorkspacePath 'appdata.txt') -Value $env:APPDATA\n",
    "utf8",
  );

  try {
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-File", hostLauncherScript, "-WorkspacePath", directory, "-AppDataPath", directory, "-HostScript", workerScript],
      { windowsHide: true },
    );
    assert.equal((await readFile(markerPath, "utf8")).trim(), directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("桌面会话监督器会启动原生提醒宿主", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-task-reminder-desktop-host-"));
  const workerScript = join(directory, "test-host.ps1");
  const markerPath = join(directory, "started.txt");
  await writeFile(
    workerScript,
    "param([string]$WorkspacePath)\nSet-Content -LiteralPath (Join-Path $WorkspacePath 'started.txt') -Value $PID\nStart-Sleep -Seconds 10\n",
    "utf8",
  );
  const supervisor = spawn(
    "powershell.exe",
    ["-NoProfile", "-File", desktopHostSupervisorScript, "-WorkspacePath", directory, "-HostScript", workerScript, "-AlwaysRun", "-PollSeconds", "1"],
    { windowsHide: true },
  );

  try {
    await waitFor(async () => {
      try {
        return (await stat(markerPath)).isFile();
      } catch {
        return false;
      }
    }, 5_000);
    assert.notEqual(Number((await readFile(markerPath, "utf8")).trim()), supervisor.pid);
  } finally {
    supervisor.kill();
    await rm(directory, { recursive: true, force: true });
  }
});

test("桌面会话监督器会在 Codex 退出后结束自身", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-task-reminder-host-exit-"));
  const supervisor = spawn(
    "powershell.exe",
    ["-NoProfile", "-File", desktopHostSupervisorScript, "-WorkspacePath", directory, "-ExitWhenCodexStops", "-CodexProcessName", "codex-task-reminder-test-missing", "-PollSeconds", "1"],
    { windowsHide: true },
  );

  try {
    const exitCode = await Promise.race<number | null | "timeout">([
      new Promise<number | null>((resolveExit, rejectExit) => {
        supervisor.once("error", rejectExit);
        supervisor.once("exit", resolveExit);
      }),
      new Promise<"timeout">((resolveTimeout) => setTimeout(() => resolveTimeout("timeout"), 3_000)),
    ]);
    assert.equal(exitCode, 0);
  } finally {
    supervisor.kill();
    await rm(directory, { recursive: true, force: true });
  }
});

test("会话启动器按需启动桌面提醒宿主", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-task-reminder-session-start-"));
  const workerScript = join(directory, "test-desktop-supervisor.ps1");
  const markerPath = join(directory, "started.txt");
  await writeFile(
    workerScript,
    "param([string]$WorkspacePath, [string]$AppDataPath, [switch]$ExitWhenCodexStops)\nSet-Content -LiteralPath (Join-Path $WorkspacePath 'started.txt') -Value $PID\nStart-Sleep -Seconds 10\n",
    "utf8",
  );

  try {
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-File", sessionStartScript, "-WorkspacePath", directory, "-AppDataPath", directory, "-DesktopSupervisorScript", workerScript, "-HiddenLauncherScript", hiddenLauncherScript],
      { windowsHide: true },
    );
    await waitFor(async () => {
      try {
        return (await stat(markerPath)).isFile();
      } catch {
        return false;
      }
    }, 5_000);
    await runPowerShell(`Stop-Process -Id ${Number((await readFile(markerPath, "utf8")).trim())} -ErrorAction SilentlyContinue`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("会话模式安装器写入 Codex 事件钩子而非 SessionStart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-task-reminder-session-install-"));
  const hooksPath = join(directory, "hooks.json");
  await writeFile(hooksPath, JSON.stringify({ description: "test", hooks: {} }), "utf8");
  await writeFile(join(directory, "Codex 提醒桌面宿主.lnk"), "placeholder", "utf8");
  const escapedInstallerScript = toPowerShellLiteral(sessionLifecycleInstallerScript);
  const escapedDirectory = toPowerShellLiteral(directory);
  const escapedHooksPath = toPowerShellLiteral(hooksPath);
  const escapedStartupPath = toPowerShellLiteral(directory);

  try {
    await runPowerShell(`
      & '${escapedInstallerScript}' -WorkspacePath '${escapedDirectory}' -HooksPath '${escapedHooksPath}' -StartupPath '${escapedStartupPath}' -TaskName 'CodexTaskReminderWatchdog-Test-${randomUUID()}'
    `);
    const hooks = JSON.parse(await readFile(hooksPath, "utf8"));
    assert.equal(hooks.hooks.SessionStart, undefined);
    assert.match(hooks.hooks.Stop[0].hooks[0].commandWindows, /hook-handler\.ts.*--source codex/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Codex Hook 安装迁移仅替换项目条目", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-task-reminder-hook-migration-"));
  const hooksPath = join(directory, "hooks.json");
  const escapedInstallerScript = toPowerShellLiteral(sessionLifecycleInstallerScript);
  const escapedUninstallScript = toPowerShellLiteral(uninstallAutostartScript);
  const escapedDirectory = toPowerShellLiteral(directory);
  const escapedHooksPath = toPowerShellLiteral(hooksPath);
  await writeFile(hooksPath, JSON.stringify({
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: "user-owned-command" }] }],
      SessionStart: [{ hooks: [{ type: "command", command: "user-owned-session-start" }] }],
    },
  }), "utf8");

  try {
    await runPowerShell(`& '${escapedInstallerScript}' -WorkspacePath '${escapedDirectory}' -HooksPath '${escapedHooksPath}' -StartupPath '${escapedDirectory}' -TaskName 'CodexTaskReminderWatchdog-Test-${randomUUID()}'`);
    const installed = JSON.parse(await readFile(hooksPath, "utf8"));
    assert.equal(installed.hooks.Stop[0].hooks[0].command, "user-owned-command");
    assert.equal(installed.hooks.SessionStart[0].hooks[0].command, "user-owned-session-start");
    const projectCommands = JSON.stringify(installed.hooks);
    assert.match(projectCommands, /hook-handler\.ts.*--source codex/);
    assert.match(projectCommands, /PermissionRequest/);
    assert.match(projectCommands, /Interrupt/);

    await runPowerShell(`& '${escapedUninstallScript}' -HooksPath '${escapedHooksPath}' -StartupPath '${escapedDirectory}' -TaskName 'CodexTaskReminderWatchdog-Test-${randomUUID()}'`);
    const uninstalled = await readFile(hooksPath, "utf8");
    assert.match(uninstalled, /user-owned-command/);
    assert.match(uninstalled, /user-owned-session-start/);
    assert.doesNotMatch(uninstalled, /hook-handler\.ts/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("可选 Agent 安装器只修改项目自己的 Hook", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-task-reminder-agent-config-"));
  const configPath = join(directory, "agent-hooks.json");
  const escapedAgentConfigScript = toPowerShellLiteral(agentConfigScript);
  const escapedConfigPath = toPowerShellLiteral(configPath);
  await writeFile(configPath, JSON.stringify({
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: "user-owned-command" }] }],
    },
  }), "utf8");

  try {
    await runPowerShell(`& '${escapedAgentConfigScript}' -Source antigravity -Action install -ConfigPath '${escapedConfigPath}'`);
    const installed = await readFile(configPath, "utf8");
    assert.match(installed, /user-owned-command/);
    assert.match(installed, /hook-handler\.ts.*--source antigravity/);

    await runPowerShell(`& '${escapedAgentConfigScript}' -Source antigravity -Action uninstall -ConfigPath '${escapedConfigPath}'`);
    const uninstalled = await readFile(configPath, "utf8");
    assert.match(uninstalled, /user-owned-command/);
    assert.doesNotMatch(uninstalled, /hook-handler\.ts.*--source antigravity/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("无窗口启动器会在后台运行 PowerShell 脚本", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-task-reminder-hidden-launcher-"));
  const workerScript = join(directory, "test-worker.ps1");
  const markerPath = join(directory, "started.txt");
  await writeFile(workerScript, "Set-Content -LiteralPath '" + markerPath.replaceAll("'", "''") + "' -Value 'started'\n", "utf8");

  try {
    await execFileAsync("wscript.exe", [hiddenLauncherScript, "-File", workerScript], { windowsHide: true });
    await waitFor(async () => {
      try {
        return (await readFile(markerPath, "utf8")).trim() === "started";
      } catch {
        return false;
      }
    }, 5_000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("一次性展示器在不展示时清理事件文件", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-task-reminder-single-event-"));
  const eventPath = join(directory, "event.json");
  const escapedDirectory = toPowerShellLiteral(directory);
  const escapedEventPath = toPowerShellLiteral(eventPath);
  const escapedHostScript = toPowerShellLiteral(reminderHostScript);
  await writeFile(eventPath, JSON.stringify({
    taskId: "task-1",
    eventId: "event-1",
    source: "codex",
    status: "completed",
    title: "测试提醒",
    occurredAt: "2026-09-19T00:00:00.000Z",
  }), "utf8");

  try {
    const { stdout } = await runPowerShell(`
      $env:APPDATA = '${escapedDirectory}'
      $env:TEST_REMINDER_HOST_NO_RUN = '1'
      & '${escapedHostScript}' -EventPath '${escapedEventPath}' -TestNoWindow
      Test-Path -LiteralPath '${escapedEventPath}'
    `);
    assert.equal(stdout.trim(), "False");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("一次性展示器拒绝无效事件文件", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-task-reminder-invalid-event-"));
  const eventPath = join(directory, "invalid.json");
  const escapedDirectory = toPowerShellLiteral(directory);
  const escapedEventPath = toPowerShellLiteral(eventPath);
  const escapedHostScript = toPowerShellLiteral(reminderHostScript);
  await writeFile(eventPath, "not-json", "utf8");

  try {
    await assert.rejects(() => runPowerShell(`
      $env:APPDATA = '${escapedDirectory}'
      $env:TEST_REMINDER_HOST_NO_RUN = '1'
      & '${escapedHostScript}' -EventPath '${escapedEventPath}' -TestNoWindow
      exit $LASTEXITCODE
    `));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("安装脚本在指定桌面目录创建工作台入口", async () => {
  const taskName = `CodexTaskReminderWatchdog-Test-${randomUUID()}`;
  const desktopPath = await mkdtemp(join(tmpdir(), "codex-task-reminder-shortcut-"));
  const startupPath = await mkdtemp(join(tmpdir(), "codex-task-reminder-startup-"));
  const escapedInstallScript = toPowerShellLiteral(installScript);
  const escapedProjectPath = toPowerShellLiteral(projectPath);
  const escapedDesktopPath = toPowerShellLiteral(desktopPath);
  const escapedStartupPath = toPowerShellLiteral(startupPath);

  try {
    await runPowerShell(`
      $ErrorActionPreference = 'Stop'
      & '${escapedInstallScript}' -WorkspacePath '${escapedProjectPath}' -TaskName '${taskName}' -DesktopPath '${escapedDesktopPath}' -StartupPath '${escapedStartupPath}' -SkipStart
    `);
    const shortcut = await stat(join(desktopPath, "Codex 提醒工作台.lnk"));
    assert.equal(shortcut.isFile(), true);
    const desktopHostShortcut = await stat(join(startupPath, "Codex 提醒桌面宿主.lnk"));
    assert.equal(desktopHostShortcut.isFile(), true);
  } finally {
    await runPowerShell(`
      Stop-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName '${taskName}' -Confirm:$false -ErrorAction SilentlyContinue
      exit 0
    `);
    await rm(desktopPath, { recursive: true, force: true });
    await rm(startupPath, { recursive: true, force: true });
  }
});
