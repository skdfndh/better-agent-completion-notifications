# 架构概览

## 事件路径

```text
Codex Hook -> hook-handler.ts -> events.ndjson -> 本地服务或原生宿主 -> 提醒界面
```

`hook-handler.ts` 读取官方命令钩子标准输入，规范化为 `TaskEvent` 后追加到工作区日志。浏览器工作台通过 SSE 接收新增事件；Windows 宿主直接监听同一日志。

## 模块

- `src/events.ts`：任务事件校验。
- `src/policy.ts`：状态语义、展示模式和静默策略。
- `src/reminder-service.ts`：UI 无关的提醒生命周期。
- `src/ui/`：本地 HTTP 服务、工作台和独立弹窗。
- `src/native/`：Windows WPF 提醒宿主和进程守护脚本。

## 数据与隐私

事件日志、偏好文件和诊断日志都属于本机运行数据，已被 `.gitignore` 排除。公开贡献请使用合成事件，避免提交真实任务标题、摘要、路径或日志。
