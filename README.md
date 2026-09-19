# 更好的 Agent 完成通知 / Better Agent Completion Notifications

![Windows](https://img.shields.io/badge/platform-Windows-0078D4?logo=windows&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-22.6%2B-339933?logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

为使用 Codex、Antigravity 或 DSH 的 Windows 用户提供一次性、可配置的任务完成提醒：任务结束、失败或需要处理时，在你正在使用的屏幕右下角清晰提示，无需让浏览器工作台常驻后台。

## 你会得到什么

- 三档提醒：遮挡式、右下角轻提醒与完全隐藏；完成提醒自动消失，失败和等待处理会保留到确认。
- 全屏媒体策略：视频、游戏或直播时可选正常提醒、仅声音或完全静默。
- 多 Agent 来源：Codex 默认可用；Antigravity 和 DSH 可按需接入并独立开关。
- 无常驻提醒进程：每条事件只启动一次原生窗口，关闭后立即退出。
- 本地优先：偏好、审计日志与待展示事件只保存在当前电脑；浏览器工作台仅用于设置、预览和诊断。

## 开始前

- Windows，原生弹窗使用 Windows PowerShell 与 WPF。
- Node.js 22.6 或更高版本。
- Codex、Antigravity 和 DSH 可单独使用；不需要一次配置全部来源。

## 五分钟开始使用

```powershell
git clone https://github.com/skdfndh/better-codex-completion-notifications.git
cd better-codex-completion-notifications
npm test
npm run hook:install
npm run ui
```

打开 `http://127.0.0.1:3300`，即可在工作台调整提醒样式、声音、全屏策略与来源开关。`hook:install` 完成后，下一次 Codex 任务结束会触发原生提醒；工作台无需保持打开。

## 接入 Codex

Codex 的 `Stop`、`PermissionRequest` 和 `Interrupt` Hook 会进入一次性分发器，分别对应完成、等待授权与中断。安装与卸载只维护本项目的 Hook 条目：

```powershell
npm run hook:install
npm run hook:uninstall
```

若需手动调用 Hook 处理器，请使用：`npm run hook -- -- --source codex`。

## 接入其他 Agent

安装会自动启用对应来源；卸载只关闭该来源，不影响声音、全屏策略或其他 Agent。

| Agent | 安装 | 卸载 | 集成方式 |
| --- | --- | --- | --- |
| Antigravity | `npm run agent:antigravity:install` | `npm run agent:antigravity:uninstall` | 管理 `%USERPROFILE%\.gemini\config\hooks.json` 中项目专属的顶级 Hook。 |
| DSH | `npm run agent:dsh:install` | `npm run agent:dsh:uninstall` | 通过官方 `@deepseek-ai/dsh-hooks-codex` bridge 加载独立 Hook 文件。 |

DSH 首次安装会通过 `npx` 获取官方 CLI 与 bridge，因此需要网络。安装器不会读取或修改 `.dsh\.credentials.yaml`、`settings.yaml`、模型或 provider；失败时会清理本次生成的运行时文件。

## 调整提醒行为

工作台可以设置展示模式、声音、全屏媒体策略和来源开关。运行数据默认位于：

```text
%APPDATA%\CodexTaskReminder\
```

其中 `preferences.json` 保存设置，`events.ndjson` 用于本地审计，`pending` 与 `dedupe` 保存短期运行状态。这些文件可能包含任务标题或摘要，不应提交到仓库。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3300` | 工作台本地服务端口。 |

## 开发与验证

```powershell
npm test
npm run demo
```

贡献前请阅读 [贡献指南](CONTRIBUTING.md)。

## 已知限制

- 原生宿主目前不能通过公开接口直接跳转到某个 Agent 的指定任务；“打开任务”保留为宿主桥接扩展点。
- DSH bridge 只运行同步命令 Hook；若 DSH 官方 bridge 的配置协议变化，需要同步更新安装器。
- 当前原生弹窗仅支持 Windows。

## 许可证

[MIT](LICENSE) © 2026 Codex Task Reminder Contributors
