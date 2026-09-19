# 架构概览

## 事件路径

```text
Codex Hook -----------------------------+
Antigravity Stop Hook ------------------+--> hook-handler.ts --> agent-adapters.ts
DSH -> dsh-hooks-codex bridge -> Stop --+
              |
              v
 event-dispatcher.ts -- 审计日志 + 磁盘去重 + 一次性事件文件
              |
              v
 隐藏 VBS 启动器 -> 一次性 WPF 展示器 -> 关闭即退出
```

`hook-handler.ts` 读取 Agent 命令 Hook 的标准输入，经适配器规范化为 `TaskEvent` 后交给分发器。分发器先写审计日志、按 `source + eventId` 做十分钟磁盘去重，再只把一次性事件文件路径传给隐藏启动器。浏览器工作台通过 SSE 查看审计事件，但不承担桌面提醒投递。

## 模块

- `src/agent-adapters.ts`：Codex、Antigravity 与 DSH Hook 负载映射。
- `src/events.ts`：任务事件校验与旧事件兼容。
- `src/event-dispatcher.ts`：来源开关、审计、去重和一次性展示器启动。
- `src/policy.ts`：状态语义、展示模式和静默策略。
- `src/reminder-service.ts`：UI 无关的提醒生命周期。
- `src/ui/`：本地 HTTP 服务、工作台和独立弹窗。
- `src/native/reminder-host.ps1`：读取一次性事件并展示 WPF 窗口。
- `src/native/install-session-lifecycle.ps1`：Codex Hook 的可逆安装迁移。
- `src/native/agent-config.ps1`：Antigravity 全局 Hook 的可逆安装与卸载。
- `src/native/install-dsh-bridge.ps1`：生成 DSH 的独立 Codex 兼容 Hook、安装官方 bridge bundle，并在失败时回滚。
- `src/agent-preferences.ts`：安装器使用的来源开关持久化入口。

## 数据与隐私

事件日志是诊断审计，不是运行时消息队列。事件文件、去重声明、偏好文件和诊断日志都属于本机运行数据，已被 `.gitignore` 排除。DSH bridge 使用项目拥有的 `%APPDATA%\CodexTaskReminder\dsh-hooks.json`，不读取凭据也不改写 `settings.yaml`。公开贡献请使用合成事件，避免提交真实任务标题、摘要、路径或日志。
