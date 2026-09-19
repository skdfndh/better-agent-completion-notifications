# 更好的 Codex 完成通知 / Better Codex Completion Notifications

为 Codex、Antigravity 和 DSH 的任务事件提供本地、可配置的醒目提醒。它将完成、等待输入、等待授权、失败和中断统一为事件，并展示为 Windows 原生弹窗；浏览器工作台只用于设置、预览和诊断。

## 功能

- 三档展示模式：遮挡式、右下角轻提醒和隐藏。
- 完成事件自动关闭；需要处理的状态持续显示至确认。
- 可选来源：Codex 默认启用，Antigravity 与 DSH 需由用户显式配置。
- 本地 JSON 偏好存储和 NDJSON 审计日志。
- 每个任务事件会启动一次桌面提醒；提醒关闭后不保留本项目的提醒进程。
- 浏览器工作台，用于预览、模拟事件和调整偏好，不影响原生桌面提醒。

## 快速开始

需要 Node.js 22.6 或更高版本。

```powershell
git clone https://github.com/skdfndh/better-codex-completion-notifications.git
cd better-codex-completion-notifications
npm test
npm run ui
```

打开 `http://127.0.0.1:3300` 进入工作台。独立弹窗预览页位于 `http://127.0.0.1:3300/popup.html`。

## Windows 原生提醒

原生提醒使用 WPF，不需要保持浏览器工作台开启。`npm run host` 只用于手动调试监听，不是日常安装方式：

```powershell
npm run host
```

## Codex Hooks

安装后，Codex 的 `Stop`、`PermissionRequest` 与 `Interrupt` Hook 会直接调用一次性分发器；不再创建开机启动、计划任务、守护器或常驻提醒宿主：

```powershell
npm run hook:install
```

卸载时仅移除本项目写入的 Codex Hook，并清理旧版本留下的启动项和提醒进程：

```powershell
npm run hook:uninstall
```

事件日志默认写入当前用户应用数据目录：

```text
%APPDATA%\CodexTaskReminder\events.ndjson
```

`Stop` 映射为完成，`PermissionRequest` 映射为等待授权，`Interrupt` 映射为中断。Codex 未提供的终态字段不会通过文本推断。若需在终端手动传入来源参数，npm 需要额外的参数分隔符：`npm run hook -- -- --source codex`。

## 可选 Antigravity 与 DSH 集成

工作台中的来源复选框只控制是否展示该来源的提醒，不会自行修改第三方 Agent 配置。Antigravity 和 DSH 默认关闭；先在工作台启用来源，再明确指定该 Agent 的 Hook JSON 配置文件进行安装：

```powershell
npm run agent:install -- -Source antigravity -ConfigPath "C:\path\to\antigravity-hooks.json"
npm run agent:install -- -Source dsh -ConfigPath "C:\path\to\dsh-hooks.json"
```

安装器分别写入 `Stop` 与 `turn/end` 命令 Hook，且只替换本项目自己的绝对路径条目。卸载使用相同的 `-Source` 与 `-ConfigPath`：

```powershell
npm run agent:uninstall -- -Source antigravity -ConfigPath "C:\path\to\antigravity-hooks.json"
npm run agent:uninstall -- -Source dsh -ConfigPath "C:\path\to\dsh-hooks.json"
```

不同 Agent 的实际配置文件位置由其安装方式决定；本项目不会猜测路径、扫描磁盘或在未明确指定时写入配置。请先确认目标 Agent 支持命令 Hook 与 JSON `hooks` 配置结构。

## 配置

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `PORT` | 否 | 工作台本地服务端口，默认 `3300`。 |

偏好保存在 `%APPDATA%\CodexTaskReminder\preferences.json`，包含展示模式、声音开关、全屏策略和来源开关。工作台将 Codex 固定显示为启用；可选来源默认关闭。审计日志、待展示事件与去重声明同样仅保留在本机，不应提交。

## 开发

```powershell
npm test
npm run demo
```

参见 [贡献指南](CONTRIBUTING.md)。

## 边界

- 原生宿主目前不能通过公开接口直接跳转到指定 Agent 任务；“打开任务”可作为宿主桥接的扩展点。
- Antigravity 与 DSH 的 Hook 格式和配置路径存在版本差异，需要用户明确提供兼容的配置文件。

## 许可证

[MIT](LICENSE) © 2026 Codex Task Reminder Contributors
