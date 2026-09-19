# Antigravity 与 DSH 原生集成设计

日期：2026-09-19  
状态：已实现并验证

## 目标

让本机已安装的 Antigravity IDE 与 DSH 能在任务结束时触发现有的一次性 Windows 提醒。提醒关闭后不保留本项目后台进程；Codex 的现有 Hook 与第三方 Hook 必须保持可用。

## 已确认的本机环境

- Antigravity IDE 已安装。其全局 Hook 文件为 `~/.gemini/config/hooks.json`；该文件当前不存在。
- DSH 用户目录为 `~/.dsh`，活动配置使用 `~/.dsh/profiles/web`。`settings.yaml` 只保存产品设置，不能直接作为 Hook JSON 写入目标。
- 本机未发现已加入 PATH 的 `dsh` 命令，因此安装器必须通过 `npx @deepseek-ai/dsh` 执行 DSH 官方 CLI，或在命令不可用时给出明确错误，不伪造配置。

## 方案

### Antigravity

新增 Antigravity 专用安装分支，默认目标为 `~/.gemini/config/hooks.json`。安装器以项目拥有的顶级名称 `better-codex-task-reminder` 写入 `Stop` 命令 Hook；卸载只删除该顶级名称，不接触同文件的其他 Hook。

命令直接调用 `hook-handler.ts --source antigravity`。适配器读取 Antigravity 的 camelCase 负载：`conversationId` 作为会话标识、`executionNum` 作为轮次标识、`terminationReason` 映射完成或失败状态；`fullyIdle: false` 的 Stop 事件不展示提醒，避免后台任务尚未结束时误报。

### DSH

使用 DSH 官方 `@deepseek-ai/dsh-hooks-codex` bridge，而不是在 `settings.yaml` 中发明 Hook 格式。

安装步骤：

1. 通过 `npx @deepseek-ai/dsh plugin --profile web add @deepseek-ai/dsh-hooks-codex` 将 bridge 安装进现有 `web` profile。
2. 在 profile 的 `cordis.patch.yml` 添加本项目拥有的 bridge 配置行，`configPath` 指向 `%APPDATA%/CodexTaskReminder/dsh-hooks.json`。
3. 创建上述独立的 Codex 兼容 Hook 文件，仅包含同步 `Stop` 命令，并调用 `hook-handler.ts --source dsh`。

独立文件避免 DSH bridge 复用真实 `~/.codex/hooks.json`，从而避免 Codex 结束时被误当作 DSH 事件。DSH bridge 的 Stop 负载采用 Codex 风格字段，因此 DSH 适配器需支持该受控负载并把它规范化为 `source: "dsh"` 的完成事件。

卸载时只移除本项目 profile patch、独立 Hook 文件中的项目条目和本项目安装的 bridge 依赖；若 bridge 在安装前已存在，则保留它。无法定位 profile、插件 CLI 失败或 bridge 配置不可验证时，安装必须失败且不留下半写入状态。

## 共用行为

- 工作台的来源开关仍是展示总开关：关闭来源时事件可写入审计日志，但不启动桌面窗口。
- 事件正文只经过一次性事件文件传给原生展示器，不进入命令行。
- 安装、卸载操作只匹配本项目绝对路径或项目拥有的明确配置键。
- 不读取或写入 `~/.dsh/.credentials.yaml`。

## 验证

- 自动化测试覆盖 Antigravity 真实 `hooks.json` 结构、camelCase Stop 负载、DSH bridge 配置写入与可逆清理。
- 对 DSH 使用临时 profile 与模拟 CLI，验证安装器不修改用户 `settings.yaml`、不会向真实 Codex Hook 文件写入 DSH 命令。
- 完整 `npm test` 必须通过。
- 实机仅在用户配置写入后执行：检查 Antigravity Hook 已加载，并用 DSH 的 `--dump-config` 确认 bridge 层存在；随后各触发一条合成结束事件确认单次提醒。

## 非目标

- 不改变 Antigravity 或 DSH 自身的通知与音效。
- 不修改 DSH 凭据、模型或 provider 设置。
- 不要求浏览器工作台在后台运行。
