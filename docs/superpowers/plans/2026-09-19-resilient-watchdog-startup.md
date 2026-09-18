# Resilient Watchdog Startup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Windows 原生提醒守护器在用户登录后由系统任务托管，并在意外退出后自动重启，同时继续按 Codex 进程状态管理提醒宿主。

**Architecture:** 安装脚本将以计划任务替代仅登录时执行一次的启动快捷方式。该任务运行常驻监督器；监督器在守护器意外退出后两秒内重新拉起它，计划任务的一分钟重启策略作为额外兜底。守护器仍是唯一负责检测 `codex.exe` 并启动或停止提醒宿主的组件，重启后会接管已有的宿主与工作台服务。

**Tech Stack:** Windows PowerShell 5.1、Windows 任务计划程序、Node.js 内置测试运行器。

**Spec:** 用户要求守护器及本项目原生提醒随 Codex 稳定开闭，且守护器异常退出后可自动恢复。

## Global Constraints

- 保持 Windows PowerShell 5.1 兼容，脚本日志与注释使用中文，PowerShell 源码仅使用 ASCII 字符。
- 不引入第三方依赖。
- 只操作名称为 `CodexTaskReminderWatchdog` 的正式任务、登录启动快捷方式及测试期间随机生成的临时任务。
- 原生提醒宿主继续由 `reminder-watchdog.ps1` 按 `codex.exe` 是否运行决定启动或停止。

---

### Task 1: 覆盖可恢复的计划任务安装行为

**Files:**
- Create: `test/native-autostart.test.ts`
- Create: `src/native/reminder-supervisor.ps1`
- Modify: `src/native/install-autostart.ps1`
- Modify: `src/native/reminder-watchdog.ps1`
- Modify: `src/native/uninstall-autostart.ps1`

**Interfaces:**
- Consumes: `install-autostart.ps1 -WorkspacePath <path> -TaskName <name> -SkipShortcuts -SkipStart`。
- Produces: 当前用户的计划任务，包含登录触发器、`reminder-supervisor.ps1` 动作和 `RestartCount = 3`、`RestartInterval = PT1M` 设置。

- [x] **Step 1: 写入失败测试**

```ts
test("安装脚本创建可重启的登录守护任务", async () => {
  const task = await installTemporaryWatchdogTask();
  assert.equal(task.logonTrigger, true);
  assert.equal(task.restartCount, 3);
  assert.equal(task.restartInterval, "PT1M");
  assert.match(task.arguments, /reminder-watchdog\.ps1/);
});
```

- [x] **Step 2: 运行测试并确认失败**

运行：`node --experimental-strip-types --test test/native-autostart.test.ts`

预期：失败，当前安装脚本不接受临时任务参数，也不会创建计划任务。

- [x] **Step 3: 实现最小安装和卸载逻辑**

```powershell
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal
Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force
```

移除旧的登录启动快捷方式；正式安装时停止旧守护器并启动注册后的正式任务。卸载时停止并注销正式任务，删除旧快捷方式。

- [x] **Step 4: 运行目标测试并确认通过**

运行：`node --experimental-strip-types --test test/native-autostart.test.ts`

预期：通过；测试会注册随机临时任务、读取真实任务计划配置，并在 `finally` 中注销它。

- [x] **Step 5: 运行完整回归测试**

运行：`npm test`

预期：所有 Node 测试通过。

- [x] **Step 6: 重新安装正式守护任务并验证运行时链路**

运行：`npm run host:install`，随后查询正式任务、守护器进程及提醒宿主的父进程。

预期：正式任务为 Ready 或 Running；守护器由任务计划程序启动；当 Codex 已运行时，提醒宿主的父进程是该守护器。

- [x] **Step 7: 提交**

```powershell
git add src/native/install-autostart.ps1 src/native/uninstall-autostart.ps1 test/native-autostart.test.ts README.md docs/superpowers/plans/2026-09-19-resilient-watchdog-startup.md
git commit -m "fix: make reminder watchdog self-recovering"
```
