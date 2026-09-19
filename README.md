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

这两项安装会自动启用工作台中的对应来源；卸载则自动关闭该来源，不会改变声音、全屏策略或其他 Agent 的设置。

Antigravity 使用其全局 Hook 文件 `%USERPROFILE%\.gemini\config\hooks.json`。安装器只维护项目拥有的 `better-codex-task-reminder` 顶级键，保留其他 Hook：

```powershell
npm run agent:antigravity:install
npm run agent:antigravity:uninstall
```

DSH 使用官方 `@deepseek-ai/dsh-hooks-codex` bridge，并在当前用户的 `web` profile 添加本项目本地 bundle。首次安装会经 `npx` 获取 DSH CLI 与 bridge，因此需要网络；它不会读取或修改 `.dsh\.credentials.yaml`、`settings.yaml`、模型或 provider：

```powershell
npm run agent:dsh:install
npm run agent:dsh:uninstall
```

DSH 的独立 Hook 配置位于 `%APPDATA%\CodexTaskReminder\dsh-hooks.json`，不会复用 Codex 的真实 Hook 文件。若 `web` profile 或 DSH CLI 不可用，安装会失败并清除本次生成的 Hook 与 bundle。旧的 `agent:install` / `agent:uninstall` 别名仅兼容 Antigravity。

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
- DSH bridge 只运行同步的命令 Hook；若 DSH 官方 bridge 的配置协议发生变动，需要更新本项目的安装器。

## 许可证

[MIT](LICENSE) © 2026 Codex Task Reminder Contributors
