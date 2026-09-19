# Antigravity 与 DSH 原生集成实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 让本机 Antigravity IDE 与 DSH 使用其官方配置机制触发现有的一次性 Windows 任务提醒。

**Architecture:** Antigravity 直接写入 `~/.gemini/config/hooks.json` 中项目独占的顶级 Hook。DSH 通过官方 `@deepseek-ai/dsh-hooks-codex` bridge 加载一个由本项目生成的独立 Codex 兼容 Hook 文件；bridge 由 DSH 官方 CLI 安装到 `web` profile，避免修改 `settings.yaml` 或复用 Codex 的真实 Hook 文件。

**Tech Stack:** Node.js 22.6+ 内置测试运行器、TypeScript 类型剥离、Windows PowerShell 5.1、`npx @deepseek-ai/dsh`。

**Spec:** `docs/superpowers/specs/2026-09-19-native-antigravity-dsh-integrations-design.md`

## Global Constraints

- 不读取或写入 `~/.dsh/.credentials.yaml`，不更改模型、provider 或 DSH 的用户设置。
- Antigravity 仅修改 `better-codex-task-reminder` 顶级 Hook；DSH 仅修改 `%APPDATA%/CodexTaskReminder` 下本项目文件和本项目安装的 profile bundle。
- Windows PowerShell 源码与传入 PowerShell 的参数使用 ASCII；标题、摘要和完整 Hook 负载不得进入命令行。
- DSH bridge Hook 必须同步执行，不能写入 `async: true`，因为官方 bridge 会跳过异步 Hook。
- 没有可用 DSH CLI、profile 不存在、CLI 安装失败或验证失败时，以非零状态退出并撤销本次创建的项目文件。
- 所有来源继续复用现有来源开关、磁盘去重、一次性事件文件和原生展示器。

## Review Focus

- Antigravity `fullyIdle: false`：不得在后台任务仍运行时通知；任务 1 覆盖。
- Antigravity 错误终止：必须映射为失败而不是完成；任务 1 覆盖。
- `~/.gemini/config/hooks.json` 已有未知顶级 Hook：安装和卸载不得改变它们；任务 2 覆盖。
- DSH profile 已有其他 bundle：安装和卸载仅处理本项目 bundle；任务 3 覆盖。
- DSH CLI 失败：不得留下独立 Hook 文件或 profile 修改；任务 3 覆盖。

---

## 文件结构

- `src/agent-adapters.ts`：将 Antigravity 的真实 camelCase Stop 负载和 DSH bridge 的 Codex 风格 Stop 负载转换为规范事件。
- `src/agent-preferences.ts`：为安装器以原子方式启用或关闭指定来源，复用 `JsonPreferencesStore`。
- `src/native/agent-config.ps1`：管理 Antigravity 的真实顶级 Hook 文件，并保留显式自定义路径入口。
- `src/native/install-dsh-bridge.ps1`：生成项目拥有的 DSH bundle 与独立 Hook 配置，调用 DSH CLI 安装或卸载，并在失败时回滚。
- `src/native/dsh-bridge-template/package.json`：由安装器复制的 bundle 模板，声明 `@deepseek-ai/dsh-hooks-codex` 依赖；安装器按实际绝对路径生成 Cordis bridge 配置。
- `test/reminder-core.test.ts`：映射真实 Agent 负载和来源偏好变化。
- `test/native-autostart.test.ts`：覆盖 Windows 安装器的真实文件格式、可逆性与 DSH CLI 失败回滚。
- `README.md`、`docs/architecture.md`：用户使用方式和真实运行时边界。

### Task 1: 规范化真实 Antigravity 与 DSH bridge 负载

**Files:**
- Modify: `src/agent-adapters.ts`
- Create: `src/agent-preferences.ts`
- Modify: `test/reminder-core.test.ts`

**Interfaces:**
- Consumes: Antigravity `Stop` JSON（`conversationId`、`executionNum`、`terminationReason`、`fullyIdle`）与 DSH bridge 的 Codex 风格 Stop JSON。
- Produces: `mapAgentHookEvent("antigravity" | "dsh", payload)` 和 `setAgentSourceEnabled(source, enabled, options?)`。

- [x] **Step 1: 写入失败测试**

```ts
test("Antigravity 仅在完全空闲时映射真实 Stop 负载", () => {
  const pending = mapAgentHookEvent("antigravity", {
    conversationId: "conversation-1", executionNum: 2,
    terminationReason: "model_stop", fullyIdle: false,
  });
  assert.equal(pending, undefined);
  assert.equal(mapAgentHookEvent("antigravity", {
    conversationId: "conversation-1", executionNum: 2,
    terminationReason: "error", fullyIdle: true,
  })?.status, "failed");
});

test("DSH bridge 的 Stop 负载保持 dsh 来源", () => {
  const event = mapAgentHookEvent("dsh", {
    hook_event_name: "Stop", session_id: "dsh-session", turn_id: "3",
  });
  assert.equal(event?.source, "dsh");
  assert.equal(event?.status, "completed");
});
```

另写入偏好持久化测试：调用 `setAgentSourceEnabled("antigravity", true, { filePath })` 后仅该来源变为 `true`，其他来源和既有偏好不变。

- [x] **Step 2: 运行测试，确认失败**

运行：`node --experimental-strip-types --test test/reminder-core.test.ts`

预期：真实 camelCase 字段与 DSH bridge Stop 尚未识别，来源偏好写入模块不存在。

- [x] **Step 3: 实现最小映射与来源偏好入口**

在 `agent-adapters.ts` 增加一个仅处理真实 Antigravity Stop 字段的分支：当 `fullyIdle !== true` 返回 `undefined`；`model_stop` 映射 `completed`，`error` 和 `max_steps_exceeded` 映射 `failed`，其他原因返回 `interrupted`。以 `conversationId` 和 `executionNum` 生成稳定事件标识。

让 DSH 映射在原有 `turn/end` 之外接受：

```ts
{ hook_event_name: "Stop", session_id: string, turn_id: string }
```

并以 `createEvent("dsh", sessionId, turnId, "bridge:Stop", "completed", ...)` 生成事件。

创建 `src/agent-preferences.ts`：使用 `JsonPreferencesStore` 读取现有偏好，覆盖一个 `enabledSources[source]` 值后保存；不得重写其余来源或展示设置。该文件同时提供受限 CLI 入口，只接受 `--source codex|antigravity|dsh` 与 `--enabled true|false`；参数无效或保存失败时以非零状态退出，供两个 PowerShell 安装器调用。

- [x] **Step 4: 运行测试，确认通过**

运行：`node --experimental-strip-types --test test/reminder-core.test.ts`

预期：真实 Antigravity、DSH bridge 和偏好变更测试通过，已有映射测试保持通过。

- [x] **Step 5: 提交**

```powershell
git add src/agent-adapters.ts src/agent-preferences.ts test/reminder-core.test.ts
git commit -m "feat: normalize native agent hook payloads"
```

### Task 2: 写入真实 Antigravity 全局 Hook

**Files:**
- Modify: `src/native/agent-config.ps1`
- Modify: `package.json`
- Modify: `test/native-autostart.test.ts`

**Interfaces:**
- Consumes: `agent-config.ps1 -Source antigravity -Action install|uninstall [-ConfigPath <path>]`。
- Produces: 默认的 `~/.gemini/config/hooks.json` 中 `better-codex-task-reminder.Stop` 数组。

- [x] **Step 1: 写入失败测试**

在临时文件预置真实 Antigravity 格式：

```json
{
  "user-linter": { "Stop": [{ "command": "user-command" }] }
}
```

安装后断言：

```ts
assert.match(installed["better-codex-task-reminder"].Stop[0].command, /hook-handler\.ts.*--source antigravity/);
assert.equal(installed["better-codex-task-reminder"].Stop[0].timeout, 5);
assert.deepEqual(installed["user-linter"], original["user-linter"]);
```

卸载后断言项目顶级键消失、`user-linter` 未变。测试还应在不传 `-ConfigPath` 时用临时 `USERPROFILE` 断言目标为 `.gemini/config/hooks.json`。

- [x] **Step 2: 运行测试，确认失败**

运行：`node --experimental-strip-types --test --test-name-pattern "Antigravity" test/native-autostart.test.ts`

预期：旧安装器仍写入错误的 `hooks.Stop` 嵌套格式且要求显式配置路径。

- [x] **Step 3: 实现 Antigravity 专用分支**

将 `agent-config.ps1` 的 `antigravity` 分支改为：

```powershell
$configPath = if ($ConfigPath) { $ConfigPath } else {
  Join-Path $env:USERPROFILE '.gemini\config\hooks.json'
}
$document.'better-codex-task-reminder' = [PSCustomObject]@{
  Stop = @([PSCustomObject]@{ type = 'command'; command = $command; timeout = 5 })
}
```

使用 `Add-Member -Force` 保留未知顶级键；卸载只移除 `better-codex-task-reminder`。将 DSH 从此脚本移除，改由任务 3 的专用安装器负责。`package.json` 分别新增 `agent:antigravity:install`、`agent:antigravity:uninstall`，保留兼容别名并在 README 中标记迁移路径。

- [x] **Step 4: 运行测试，确认通过**

运行：`node --experimental-strip-types --test --test-name-pattern "Antigravity" test/native-autostart.test.ts`

预期：真实 schema、默认路径、自定义路径、未知 Hook 保留和卸载均通过。

- [x] **Step 5: 提交**

```powershell
git add src/native/agent-config.ps1 package.json test/native-autostart.test.ts
git commit -m "feat: install native Antigravity hooks"
```

### Task 3: 安装 DSH 官方 bridge 与独立 Hook 文件

**Files:**
- Create: `src/native/install-dsh-bridge.ps1`
- Create: `src/native/dsh-bridge-template/package.json`
- Modify: `package.json`
- Modify: `test/native-autostart.test.ts`

**Interfaces:**
- Consumes: `install-dsh-bridge.ps1 -Action install|uninstall [-DshHome <path>] [-Profile web] [-DshCliPath <path>]`。
- Produces: `%APPDATA%/CodexTaskReminder/dsh-hooks.json` 和 DSH profile 中名为 `better-codex-task-reminder-dsh-bridge` 的官方 bundle。

- [x] **Step 1: 写入失败测试**

创建临时 DSH home、临时 `%APPDATA%` 与模拟 CLI `.cmd`。模拟 CLI 将其参数追加进文本文件并在可配置的退出码后退出。安装测试断言：

```ts
assert.equal(JSON.parse(await readFile(dshHooksPath, "utf8")).hooks.Stop[0].hooks[0].async, undefined);
assert.match(await readFile(fakeCliLogPath, "utf8"), /plugin --profile web add/);
assert.match(await readFile(bundlePatchPath, "utf8"), /@deepseek-ai\/dsh-hooks-codex/);
assert.doesNotMatch(await readFile(settingsPath, "utf8"), /better-codex-task-reminder/);
```

失败路径令模拟 CLI 返回 1，断言独立 Hook 文件和 bundle 目录均不存在，且 `settings.yaml` 字节不变。卸载测试断言 CLI 收到 `plugin --profile web remove better-codex-task-reminder-dsh-bridge`，但预置的其他 profile bundle 仍在。

- [x] **Step 2: 运行测试，确认失败**

运行：`node --experimental-strip-types --test --test-name-pattern "DSH bridge" test/native-autostart.test.ts`

预期：专用安装器和 bundle 模板不存在。

- [x] **Step 3: 实现可回滚 DSH bridge 安装器**

`install-dsh-bridge.ps1` 使用以下明确路径：

```powershell
$resolvedDshHome = if ($DshHome) { $DshHome } else { Join-Path $env:USERPROFILE '.dsh' }
$profilePath = Join-Path $resolvedDshHome "profiles\$Profile"
$runtimePath = Join-Path $env:APPDATA 'CodexTaskReminder'
$dshHooksPath = Join-Path $runtimePath 'dsh-hooks.json'
$bundlePath = Join-Path $runtimePath 'dsh-bridge-bundle'
```

安装时复制 `package.json` 模板，并生成 bundle `cordis.patch.yml`。该 YAML 以单引号标量写入经 YAML 转义后的 `$dshHooksPath`，结构为一个 `id: better-codex-task-reminder-dsh-hooks` 的 `@deepseek-ai/dsh-hooks-codex` bridge，`config.configPath` 指向独立 Hook 文件；生成仅含同步 Stop command 的独立 Hook JSON。模板包固定声明 `@deepseek-ai/dsh-hooks-codex` 依赖和 `dsh.bundle.patch` 指向该生成文件。之后调用：

```powershell
& $DshCliPath '@deepseek-ai/dsh' 'plugin' '--profile' $Profile 'add' $bundlePath
```

默认 `$DshCliPath` 为 `npx.cmd`。CLI 失败时删除本次新建的 bundle 和 Hook 文件后重新抛出；若 `add` 成功但后续验证失败，则先用同样的 `npx @deepseek-ai/dsh plugin --profile <profile> remove better-codex-task-reminder-dsh-bridge` 回滚 profile，再清理项目文件。卸载前读取 profile 的 `package.json`，只有其中列出本项目 bundle 时才调用 remove；随后删除项目拥有的 runtime 文件。

`package.json` 新增 `agent:dsh:install` 与 `agent:dsh:uninstall`，把后续参数透传给此脚本。

- [x] **Step 4: 运行测试，确认通过**

运行：`node --experimental-strip-types --test --test-name-pattern "DSH bridge" test/native-autostart.test.ts`

预期：成功安装、同步 Hook、卸载、第三方 bundle 保留和失败回滚测试通过。

- [x] **Step 5: 提交**

```powershell
git add src/native/install-dsh-bridge.ps1 src/native/dsh-bridge-template package.json test/native-autostart.test.ts
git commit -m "feat: install DSH notification bridge"
```

### Task 4: 补齐命令文档、来源启用和实机验证

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/superpowers/specs/2026-09-19-native-antigravity-dsh-integrations-design.md`
- Modify: `docs/superpowers/plans/2026-09-19-native-antigravity-dsh-integrations.md`
- Modify: `test/reminder-core.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `setAgentSourceEnabled`、Task 2/3 安装命令。
- Produces: 可复制的安装/卸载说明及可复核的最终验证记录。

- [x] **Step 1: 写入失败测试**

增加安装后来源启用测试：运行来源启用入口后断言 Antigravity 或 DSH 变为启用，而 Codex、声音、全屏策略和另一可选来源保持原值。增加读取不存在 DSH runtime 或 profile 时抛出包含目标绝对路径的可操作错误的测试。

- [x] **Step 2: 运行测试，确认失败**

运行：`node --experimental-strip-types --test test/reminder-core.test.ts test/native-autostart.test.ts`

预期：安装命令尚未调用来源偏好入口，缺少错误契约或文档检查点。

- [x] **Step 3: 连接安装后启用与文档**

在两个安装器成功完成后，以 Node 类型剥离命令调用来源偏好入口：

```powershell
node --experimental-strip-types "$projectPath\src\agent-preferences.ts" --source $Source --enabled true
```

卸载完成后改为 `--enabled false`。README 只列出以下真实命令：

```powershell
npm run agent:antigravity:install
npm run agent:dsh:install
npm run agent:antigravity:uninstall
npm run agent:dsh:uninstall
```

说明 DSH 首次安装会通过 `npx` 获取官方 bridge，需网络；不能启动 CLI 时不会更改凭据或 `settings.yaml`。架构文档绘制 Antigravity Hook 与 DSH bridge 汇入同一 `hook-handler.ts` 的事件路径。

- [x] **Step 4: 运行完整测试与实机检查**

运行：`npm test`

预期：全部测试通过。

实机按顺序执行：

```powershell
npm run agent:antigravity:install
npm run agent:dsh:install
npx @deepseek-ai/dsh --profile web --dump-config
```

确认 Antigravity Hook 文件含项目顶级键、DSH dump 含 `@deepseek-ai/dsh-hooks-codex` 和独立 `dsh-hooks.json` 路径。各用合成结束负载调用 `hook-handler.ts --source <source>`，确认各显示一次提醒；关闭后检查无 `reminder-host.ps1` 常驻进程。

- [x] **Step 5: 更新状态并提交**

将规格状态更新为“已实现并验证”，勾选计划步骤并记录完整测试和实机结果。

```powershell
git add README.md docs/architecture.md docs/superpowers/specs/2026-09-19-native-antigravity-dsh-integrations-design.md docs/superpowers/plans/2026-09-19-native-antigravity-dsh-integrations.md test/reminder-core.test.ts test/native-autostart.test.ts
git commit -m "docs: document native agent integrations"
```

## 实施记录

- 2026-09-19：`npm test` 通过 49/49；Antigravity Hook、DSH `web` profile bridge 与两条合成结束事件均已在本机验证。
