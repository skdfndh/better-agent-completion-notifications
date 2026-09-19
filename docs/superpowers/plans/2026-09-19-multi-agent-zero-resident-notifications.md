# Multi-Agent Zero-Resident Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Codex、Antigravity 与 DSH 的任务事件直接触发一次性 Windows 原生提醒，提醒关闭后不保留本项目后台进程。

**Architecture:** 各适配器把 Hook 负载转换为带来源和事件标识的 `TaskEvent`。统一分发器校验来源开关、写审计日志、以磁盘声明做短时间去重，再经隐藏启动器将事件文件路径交给一次性 WPF 展示器；展示器关闭即退出。浏览器工作台仅用于设置、预览和查看审计事件。

**Tech Stack:** Node.js 22.6+ 内置测试运行器、TypeScript（实验性类型剥离）、Windows PowerShell 5.1、WPF、Windows Script Host。

**Spec:** `docs/superpowers/specs/2026-09-19-multi-agent-zero-resident-notifications-design.md`

## Global Constraints

- 仅使用 Node.js 内置模块与既有 Windows 组件，不添加第三方依赖。
- Windows PowerShell 5.1 源码和传给 PowerShell 的参数保持 ASCII。
- 命令行不得携带标题、摘要、提示词、文件内容或完整 Hook 负载；展示器仅接收一次性事件文件路径。
- 不创建开机启动、计划任务、常驻提醒宿主、守护器或轮询进程。
- 未启用 Antigravity 或 DSH 时，不写其配置，也不影响 Codex Hook 或浏览器工作台。
- 安装、卸载只增删本项目绝对路径对应的 Hook，不覆盖用户已有 Hook。
- 三档展示模式、声音开关、全屏策略对全部来源保持现有语义。

## Review Focus

- 并发重复 Hook：同一来源与 `eventId` 在去重窗口内只能展示一次；任务 2 用并发测试覆盖。
- 旧事件和旧偏好：缺少 `source`、`eventId` 或 `enabledSources` 时回退为 Codex 默认；任务 1 覆盖。
- 含空格、中文或引号的标题和摘要：不得进入 `wscript.exe` 或 PowerShell 命令行；任务 2 覆盖。
- 隐藏、全屏仅声音、全屏关闭：展示器必须退出并清理事件文件；任务 3 覆盖。
- 用户已有 Hook：迁移仅删除项目条目，未知条目原样保留；任务 4 覆盖。

---

## 文件结构

- `src/types.ts`：来源、事件标识和来源启用偏好类型。
- `src/events.ts`：兼容旧数据的事件校验。
- `src/preferences.ts`：`enabledSources` 的默认与持久化。
- `src/agent-adapters.ts`：三个 Agent 的 Hook 负载映射。
- `src/event-dispatcher.ts`：审计、去重、一次性事件文件和启动。
- `src/hook-handler.ts`：选择适配器并调用分发器。
- `src/native/reminder-host.ps1`：`-EventPath` 一次性展示模式。
- `src/native/install-session-lifecycle.ps1`：Codex Hook 的可逆安装迁移。
- `src/native/agent-config.ps1`：Antigravity、DSH 的显式安装与卸载。
- `src/ui/index.html`、`src/ui/app.js`、`src/ui/reminder-core.js`：来源开关。
- `test/reminder-core.test.ts`、`test/event-dispatcher.test.ts`、`test/native-autostart.test.ts`、`test/ui-server.test.ts`：对应测试。

### Task 1: 扩展事件模型、偏好和 Agent 映射

**Files:**
- Create: `src/agent-adapters.ts`
- Modify: `src/types.ts`
- Modify: `src/events.ts`
- Modify: `src/codex-hooks.ts`
- Modify: `src/preferences.ts`
- Modify: `test/reminder-core.test.ts`

**Interfaces:**
- Consumes: 现有 `TaskEvent`、Codex Hook 负载、`JsonPreferencesStore`。
- Produces: `AgentSource`、`EnabledSources`、带 `source` 和 `eventId` 的 `TaskEvent`、`mapAgentHookEvent(source, payload, occurredAt)`。

- [ ] **Step 1: 写入失败测试**

```ts
test("旧事件和旧偏好回退到 Codex", async () => {
  const event = validateTaskEvent(completedEvent);
  assert.equal(event.source, "codex");
  assert.match(event.eventId, /^codex:/);
  await writeFile(filePath, JSON.stringify({ mode: "light", soundEnabled: true }), "utf8");
  assert.deepEqual((await new JsonPreferencesStore(filePath).load()).enabledSources, {
    codex: true, antigravity: false, dsh: false,
  });
});

test("各 Agent 映射状态和稳定事件标识", () => {
  assert.equal(mapAgentHookEvent("codex", codexStop)?.eventId, "codex:session-1:turn-1:Stop");
  assert.equal(mapAgentHookEvent("antigravity", antigravityStop)?.source, "antigravity");
  assert.equal(mapAgentHookEvent("dsh", dshCompleted)?.status, "completed");
  assert.equal(mapAgentHookEvent("dsh", dshFailed)?.status, "failed");
});
```

- [ ] **Step 2: 运行测试，确认失败**

运行：`node --experimental-strip-types --test test/reminder-core.test.ts`

预期：因新来源类型、事件标识与映射器不存在而失败。

- [ ] **Step 3: 实现最小模型和映射**

在 `src/types.ts` 增加：

```ts
export const AGENT_SOURCES = ["codex", "antigravity", "dsh"] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];
export type EnabledSources = Record<AgentSource, boolean>;
```

`TaskEvent` 增加 `source: AgentSource` 与 `eventId: string`。`validateTaskEvent` 对缺失来源回退到 `codex`，并用规范化的来源、任务、状态和时间生成缺失的事件标识；提供的来源或标识必须为非空合法字符串。`DEFAULT_PREFERENCES` 和旧配置加载结果均补齐 `{ codex: true, antigravity: false, dsh: false }`。

`src/agent-adapters.ts` 只读取已知字段：Codex 和 Antigravity 使用 `hook_event_name`、`session_id`、`turn_id`；DSH 使用 `event`、`turn.id`、`session.id`、`reason`。未知事件、缺少标识、未知 DSH 原因一律返回 `undefined`，不从文本推断状态。

- [ ] **Step 4: 运行测试，确认通过**

运行：`node --experimental-strip-types --test test/reminder-core.test.ts`

预期：新增兼容、来源和映射测试通过，原有策略测试保持通过。

- [ ] **Step 5: 提交**

```powershell
git add src/types.ts src/events.ts src/codex-hooks.ts src/agent-adapters.ts src/preferences.ts test/reminder-core.test.ts
git commit -m "feat: normalize multi-agent task events"
```

### Task 2: 分发一次性事件并进行磁盘去重

**Files:**
- Create: `src/event-dispatcher.ts`
- Create: `test/event-dispatcher.test.ts`
- Modify: `src/event-log.ts`
- Modify: `src/hook-handler.ts`

**Interfaces:**
- Consumes: `TaskEvent`、`JsonPreferencesStore`、`appendTaskEvent`、隐藏启动器路径。
- Produces: `dispatchTaskEvent(event, options): Promise<DispatchResult>`，其中结果为 `launched`、`suppressed-source` 或 `duplicate`。

- [ ] **Step 1: 写入失败测试**

```ts
test("首次事件写审计日志、创建一次性文件且不泄漏正文到参数", async () => {
  const launches: string[] = [];
  const result = await dispatchTaskEvent(event, {
    appDataPath: directory,
    launch: async (eventPath) => launches.push(eventPath),
  });
  assert.equal(result.kind, "launched");
  assert.equal(launches[0].includes(event.title), false);
  assert.equal(launches[0].endsWith(".json"), true);
});

test("并发重复事件只取得一个声明", async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => dispatchTaskEvent(event, options)));
  assert.equal(results.filter((item) => item.kind === "launched").length, 1);
  assert.equal(results.filter((item) => item.kind === "duplicate").length, 7);
});
```

同时覆盖：禁用来源时不启动；启动器报错时删除声明；10 分钟前的声明在下次分发前清理。

- [ ] **Step 2: 运行测试，确认失败**

运行：`node --experimental-strip-types --test test/event-dispatcher.test.ts`

预期：因分发器模块不存在而失败。

- [ ] **Step 3: 实现分发器和 Hook 入口**

在 `%APPDATA%\CodexTaskReminder\pending` 写入一次性事件 JSON。在 `dedupe` 目录以 `sha256(source + "\0" + eventId)` 命名文件，通过 `open(path, "wx")` 原子取得声明；声明记录时间，清除超过十分钟的文件。

```ts
export type NativeLauncher = (eventPath: string) => Promise<void>;
export async function dispatchTaskEvent(
  event: TaskEvent,
  options?: { appDataPath?: string; preferencesStore?: JsonPreferencesStore; launch?: NativeLauncher },
): Promise<DispatchResult>;
```

默认启动器以 `detached: true`、`windowsHide: true`、`stdio: "ignore"` 调用 `wscript.exe` 与 `reminder-hidden-launcher.vbs`，参数固定为脚本路径、`-File`、`reminder-host.ps1`、`-EventPath`、暂存文件。随后 `unref()`；不得向命令行传递事件正文。

`hook-handler.ts` 解析 `--source <codex|antigravity|dsh>`，调用 `mapAgentHookEvent` 和分发器。无效负载无副作用；有效事件启动失败时输出只含来源与事件标识的错误并以非零状态结束。

- [ ] **Step 4: 运行测试，确认通过**

运行：`node --experimental-strip-types --test test/event-dispatcher.test.ts`

预期：审计、去重、脱敏、开关和失败回滚测试通过。

- [ ] **Step 5: 提交**

```powershell
git add src/event-log.ts src/event-dispatcher.ts src/hook-handler.ts test/event-dispatcher.test.ts
git commit -m "feat: dispatch one-shot native reminders"
```

### Task 3: 把 WPF 宿主改为一次性展示器

**Files:**
- Modify: `src/native/reminder-host.ps1`
- Modify: `src/native/reminder-hidden-launcher.vbs`
- Modify: `test/native-autostart.test.ts`

**Interfaces:**
- Consumes: `reminder-host.ps1 -EventPath <absolute-json-path>`。
- Produces: 读取一个有效事件、遵守偏好展示或播放声音、关闭即退出并清理事件文件的 WPF 进程。

- [ ] **Step 1: 写入失败测试**

```ts
test("一次性展示器在不展示时清理事件文件", async () => {
  await writeFile(eventPath, JSON.stringify(event), "utf8");
  const { stdout } = await runPowerShell(`
    $env:APPDATA = '${escapedDirectory}'
    & '${escapedHostScript}' -EventPath '${escapedEventPath}' -TestNoWindow
    Test-Path -LiteralPath '${escapedEventPath}'
  `);
  assert.equal(stdout.trim(), "False");
});
```

另外断言：无效 JSON 或缺失 `-EventPath` 时退出码非零；VBS 启动器只逐项引用调用参数，不读取事件内容。

- [ ] **Step 2: 运行测试，确认失败**

运行：`node --experimental-strip-types --test test/native-autostart.test.ts`

预期：`-EventPath` 与 `-TestNoWindow` 尚不受支持而失败。

- [ ] **Step 3: 实现一次性分支**

在 `reminder-host.ps1` 参数中增加：

```powershell
[string]$EventPath,
[switch]$TestNoWindow
```

新增 `Read-EventFile`：UTF-8 读取并验证 `taskId`、`eventId`、`source`、`status`、`title`、`occurredAt`；读取成功后删除文件。失败时仅记录来源和文件名后退出 1。让 `Show-ReminderWindow` 返回窗口；在 `EventPath` 模式给 `Closed` 注册 `Dispatcher.BeginInvokeShutdown`。隐藏、全屏关闭、仅声音策略完成后立即退出。没有 `EventPath` 时保留 `npm run host` 调试监听模式，但安装器与 Hook 不得启动它。

- [ ] **Step 4: 运行测试，确认通过**

运行：`node --experimental-strip-types --test test/native-autostart.test.ts`

预期：成功、无效文件、抑制清理和参数脱敏测试通过；不再符合架构的旧常驻监督器测试在同一提交中替换为一次性行为测试。

- [ ] **Step 5: 提交**

```powershell
git add src/native/reminder-host.ps1 src/native/reminder-hidden-launcher.vbs test/native-autostart.test.ts
git commit -m "feat: exit native reminder after one event"
```

### Task 4: 迁移 Codex Hook 并移除常驻启动链路

**Files:**
- Modify: `src/native/install-session-lifecycle.ps1`
- Modify: `src/native/uninstall-autostart.ps1`
- Modify: `src/native/reminder-session-start.ps1`
- Modify: `src/native/reminder-desktop-host-supervisor.ps1`
- Modify: `package.json`
- Modify: `test/native-autostart.test.ts`

**Interfaces:**
- Consumes: 用户级 `~/.codex/hooks.json` 和项目绝对路径。
- Produces: `npm run hook:install`、`npm run hook:uninstall`；`Stop`、`PermissionRequest`、`Interrupt` 调用 `hook-handler.ts --source codex`，不存在项目 `SessionStart` 宿主 Hook。

- [ ] **Step 1: 写入失败测试**

在临时 `hooks.json` 预置用户拥有的 `Stop` 和 `SessionStart` 条目，运行安装器后断言：

```ts
assert.equal(hooks.hooks.Stop[0].hooks[0].command, "user-owned-command");
assert.match(findProjectHook(hooks, "Stop").commandWindows, /hook-handler\.ts.*--source codex/);
assert.equal(findProjectHook(hooks, "SessionStart"), undefined);
```

运行卸载器后断言未知条目仍在、项目条目消失；进程查询不再匹配 `reminder-desktop-host-supervisor.ps1`、`reminder-session-start.ps1` 或无事件参数的 `reminder-host.ps1`。

- [ ] **Step 2: 运行测试，确认失败**

运行：`node --experimental-strip-types --test test/native-autostart.test.ts`

预期：安装器仍写入 `SessionStart`，测试失败。

- [ ] **Step 3: 实现可逆迁移**

按项目绝对路径删除旧 `reminder-session-start.ps1`、旧 `hook-handler.ts` 条目，再添加三个项目拥有的 Codex 事件 Hook，其他条目原样保留。使用 UTF-8 无 BOM 写配置。卸载脚本继续清理旧任务、快捷方式与旧进程。`package.json` 新增：

```json
"hook:install": "powershell -NoProfile -File src/native/install-session-lifecycle.ps1",
"hook:uninstall": "powershell -NoProfile -File src/native/uninstall-autostart.ps1"
```

- [ ] **Step 4: 运行测试，确认通过**

运行：`node --experimental-strip-types --test test/native-autostart.test.ts`

预期：仅项目 Hook 被迁移，遗留常驻链路被停止和移除。

- [ ] **Step 5: 提交**

```powershell
git add src/native/install-session-lifecycle.ps1 src/native/uninstall-autostart.ps1 src/native/reminder-session-start.ps1 src/native/reminder-desktop-host-supervisor.ps1 package.json test/native-autostart.test.ts
git commit -m "fix: replace Codex resident host with event hooks"
```

### Task 5: 加入可选 Antigravity、DSH 配置与工作台来源开关

**Files:**
- Create: `src/native/agent-config.ps1`
- Modify: `src/ui/index.html`
- Modify: `src/ui/app.js`
- Modify: `src/ui/reminder-core.js`
- Modify: `src/preferences.ts`
- Modify: `test/native-autostart.test.ts`
- Modify: `test/ui-server.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `agent-config.ps1 -Source <antigravity|dsh> -Action <install|uninstall> -ConfigPath <path>` 与偏好 `enabledSources`。
- Produces: `npm run agent:install -- --source antigravity`、`npm run agent:uninstall -- --source dsh` 和来源复选框。

- [ ] **Step 1: 写入失败测试**

```ts
test("可选 Agent 安装器只修改项目自己的 Hook", async () => {
  await runPowerShell(`& '${escapedAgentConfig}' -Source antigravity -Action install -ConfigPath '${escapedConfig}'`);
  assert.match(await readFile(configPath, "utf8"), /hook-handler\.ts.*--source antigravity/);
  await runPowerShell(`& '${escapedAgentConfig}' -Source antigravity -Action uninstall -ConfigPath '${escapedConfig}'`);
  assert.match(await readFile(configPath, "utf8"), /user-owned-command/);
});
```

在 `test/ui-server.test.ts` 断言 HTML 含 `data-source="codex"`、`data-source="antigravity"`、`data-source="dsh"`，并断言禁用来源不会进入浏览器预览服务。

- [ ] **Step 2: 运行测试，确认失败**

运行：`node --experimental-strip-types --test test/native-autostart.test.ts test/ui-server.test.ts`

预期：适配器安装器与来源控件尚不存在而失败。

- [ ] **Step 3: 实现可选配置和 UI**

`agent-config.ps1` 仅在用户显式运行时解析默认配置路径；Antigravity 写入 `Stop` 命令 Hook，DSH 写入 `turn/end` 命令订阅，命令均为 `node --experimental-strip-types <project>\src\hook-handler.ts --source <source>`。安装前删除相同项目路径条目，卸载也只删除该条目。

工作台设置区加入三个来源复选框：Codex 固定开启、Antigravity 与 DSH 默认关闭。保存时更新 `preferences.enabledSources`；浏览器核心预览前检查来源开关。`package.json` 新增 `agent:install` 和 `agent:uninstall`，透传参数给 PowerShell 脚本。

- [ ] **Step 4: 运行测试，确认通过**

运行：`node --experimental-strip-types --test test/native-autostart.test.ts test/ui-server.test.ts`

预期：配置可逆、未知条目保留、来源开关和旧偏好均通过。

- [ ] **Step 5: 提交**

```powershell
git add src/native/agent-config.ps1 src/ui/index.html src/ui/app.js src/ui/reminder-core.js src/preferences.ts package.json test/native-autostart.test.ts test/ui-server.test.ts
git commit -m "feat: add optional Antigravity and DSH adapters"
```

### Task 6: 更新文档并进行全量验证

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/superpowers/specs/2026-09-19-multi-agent-zero-resident-notifications-design.md`
- Modify: `docs/superpowers/plans/2026-09-19-multi-agent-zero-resident-notifications.md`

**Interfaces:**
- Consumes: 已完成的 Hook、安装脚本、工作台设置与事件分发器。
- Produces: 不依赖常驻宿主的用户说明、实际验证记录。

- [ ] **Step 1: 写入文档检查点**

README 必须包含：

```text
每个任务事件会启动一次桌面提醒；提醒关闭后不保留本项目的提醒进程。
npm run hook:install
npm run agent:install -- --source antigravity
npm run agent:install -- --source dsh
```

架构图替换为“适配器 -> 分发器 -> 一次性展示器”，说明审计日志不是运行时消息队列。

- [ ] **Step 2: 运行完整测试**

运行：`npm test`

预期：全部测试通过，临时目录、测试进程和配置均被清理。

- [ ] **Step 3: 执行实际单次提醒检查**

运行 `npm run hook:install`，再用合成 Codex `Stop` JSON 调用 `npm run hook -- --source codex`。确认提醒出现一次并关闭；随后运行：

```powershell
Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and $_.CommandLine -match 'reminder-(desktop-host-supervisor|session-start|host)\.ps1'
}
```

预期：关闭后无匹配进程。运行 `npm run hook:uninstall`，确认仅项目 Hook 被移除；未获得用户显式选择时，不安装 Antigravity 或 DSH。

- [ ] **Step 4: 更新状态并提交**

将设计状态改为“已实现并验证”，勾选计划中的完成步骤，记录实际测试与运行时结果。

```powershell
git add README.md docs/architecture.md docs/superpowers/specs/2026-09-19-multi-agent-zero-resident-notifications-design.md docs/superpowers/plans/2026-09-19-multi-agent-zero-resident-notifications.md
git commit -m "docs: document zero-resident agent notifications"
```
