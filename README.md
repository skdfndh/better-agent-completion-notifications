# 更好的 Codex 完成通知 / Better Codex Completion Notifications

为 Codex 任务事件提供本地、可配置的醒目提醒。它将任务完成、等待输入、等待授权、失败和中断统一为事件流，并可展示为浏览器工作台或 Windows 原生弹窗。

## 功能

- 三档展示模式：遮挡式、右下角轻提醒和隐藏。
- 完成事件自动关闭；需要处理的状态持续显示至确认。
- 本地 SSE 事件流、JSON 偏好存储和 NDJSON 事件日志。
- Windows WPF 原生提醒宿主，可独立于浏览器运行。
- 浏览器工作台，用于预览、模拟事件和调整偏好；默认随 Codex 在后台启动但不会自动打开浏览器。

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

原生宿主使用 WPF，不需要保持浏览器工作台开启：

```powershell
npm run host
```

可选地，在 Windows 登录时安装守护器，让它在检测到 Codex 进程后启动提醒宿主和工作台后台服务：

```powershell
npm run host:install
```

移除登录任务：

```powershell
npm run host:uninstall
```

## Codex Hooks

本项目接收 Codex Hooks 写入的规范化任务事件。将钩子配置为调用 `npm run hook` 对应的处理器，并让处理器接收官方命令钩子标准输入。事件日志默认写入当前工作区：

```text
<workspace>/.codex/codex-task-reminder/events.ndjson
```

`Stop` 映射为完成，`PermissionRequest` 映射为等待授权，`Interrupt` 映射为中断。Codex 未提供的终态字段不会通过文本推断。

## 配置

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `CODEX_TASK_REMINDER_WORKSPACE` | 否 | 工作台或原生宿主监听的工作区路径；未设置时自动向上查找 `.codex`。 |
| `PORT` | 否 | 工作台本地服务端口，默认 `3300`。 |

偏好保存在当前用户的应用数据目录中，包含展示模式、声音开关和“随 Codex 启动工作台服务”（默认开启）。该服务仅在后台运行；可通过工作台开关关闭，或从桌面“启动 Codex 提醒工作台”入口手动恢复。不要提交工作区 `.codex/` 目录或偏好文件。

## 开发

```powershell
npm test
npm run demo
```

参见 [贡献指南](CONTRIBUTING.md)。

## 边界

- 原生宿主目前不能通过公开接口直接跳转到指定 Codex 任务；“打开任务”可作为宿主桥接的扩展点。
- 游戏全屏自动识别和多显示器定位仍是后续增强方向。

## 许可证

[MIT](LICENSE) © 2026 Codex Task Reminder Contributors
