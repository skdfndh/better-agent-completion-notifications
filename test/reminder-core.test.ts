import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateTaskEvent } from "../src/events.ts";
import { mapCodexHookEvent } from "../src/codex-hooks.ts";
import { mapAgentHookEvent } from "../src/agent-adapters.ts";
import { appendTaskEvent, defaultEventLogPath } from "../src/event-log.ts";
import { DEFAULT_PREFERENCES, JsonPreferencesStore } from "../src/preferences.ts";
import { decideReminder } from "../src/policy.ts";
import { ReminderService } from "../src/reminder-service.ts";

const completedEvent = {
  taskId: "task-1",
  status: "completed",
  title: "完成任务",
  occurredAt: "2026-09-17T10:00:00.000Z",
};

test("拒绝未知任务状态", () => {
  assert.throws(
    () => validateTaskEvent({ ...completedEvent, status: "running" }),
    /不支持的任务状态/,
  );
});

test("轻提醒的正常完成事件在五秒后自动关闭", () => {
  const event = validateTaskEvent(completedEvent);
  const decision = decideReminder(event, DEFAULT_PREFERENCES, { isFullScreen: false }, () => "r-1");

  assert.equal(decision.kind, "display");
  if (decision.kind !== "display") return;
  assert.deepEqual(decision.presentation.dismissal, { kind: "automatic", afterMs: 5_000 });
  assert.equal(decision.presentation.location, "codex-display-bottom-right");
  assert.equal(decision.presentation.visualTone, "success");
});

test("特殊状态在轻提醒中持续显示并使用对应语义", () => {
  const event = validateTaskEvent({ ...completedEvent, status: "failed" });
  const decision = decideReminder(event, DEFAULT_PREFERENCES, { isFullScreen: false }, () => "r-2");

  assert.equal(decision.kind, "display");
  if (decision.kind !== "display") return;
  assert.deepEqual(decision.presentation.dismissal, { kind: "manual" });
  assert.equal(decision.presentation.visualTone, "error");
  assert.equal(decision.presentation.soundCue, "error");
});

test("隐藏模式和全屏完全关闭均不展示提醒", () => {
  const event = validateTaskEvent(completedEvent);
  const hidden = decideReminder(event, { ...DEFAULT_PREFERENCES, mode: "hidden" }, { isFullScreen: false }, () => "r-3");
  const fullscreenDisabled = decideReminder(
    event,
    { ...DEFAULT_PREFERENCES, fullscreenReminderMode: "disabled" },
    { isFullScreen: true },
    () => "r-4",
  );

  assert.deepEqual(hidden, { kind: "suppressed", reason: "hidden-mode" });
  assert.deepEqual(fullscreenDisabled, { kind: "suppressed", reason: "fullscreen-disabled" });
});

test("全屏仅声音不创建展示提醒", () => {
  const event = validateTaskEvent({ ...completedEvent, status: "needs_input" });
  const decision = decideReminder(
    event,
    { ...DEFAULT_PREFERENCES, fullscreenReminderMode: "sound_only" },
    { isFullScreen: true },
    () => "r-fullscreen",
  );

  assert.deepEqual(decision, { kind: "sound-only", soundCue: "attention" });
});

test("遮挡提醒必须通过确认关闭，未来 UI 可订阅操作结果", () => {
  const changes: string[] = [];
  const service = new ReminderService({ ...DEFAULT_PREFERENCES, mode: "blocking" }, () => "r-5");
  service.subscribe((change) => changes.push(change.kind));

  const decision = service.receive(completedEvent, { isFullScreen: false });
  assert.equal(decision.kind, "display");
  if (decision.kind !== "display") return;

  assert.equal(service.dismiss("r-5"), false);
  assert.equal(service.openTask("r-5"), "task-1");
  assert.equal(service.acknowledge("r-5"), true);
  assert.deepEqual(changes, ["show", "close"]);
  assert.deepEqual(service.listActive(), []);
});

test("损坏的偏好文件回退至默认设置", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-task-reminder-"));
  const filePath = join(directory, "preferences.json");
  await writeFile(filePath, "不是 JSON", "utf8");
  const store = new JsonPreferencesStore(filePath);

  assert.deepEqual(await store.load(), DEFAULT_PREFERENCES);
});

test("旧偏好文件默认启用工作台后台服务", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-task-reminder-preferences-"));
  const filePath = join(directory, "preferences.json");
  await writeFile(filePath, JSON.stringify({ mode: "light", soundEnabled: false }), "utf8");

  const preferences = await new JsonPreferencesStore(filePath).load();
  assert.equal(preferences.workbenchServiceEnabled, true);
  assert.equal(preferences.fullscreenReminderMode, "normal");
  assert.equal(preferences.soundEnabled, false);
});

test("官方 Stop、PermissionRequest 和 Interrupt 钩子映射为规范化事件", () => {
  const payload = { session_id: "session-1", turn_id: "turn-1" };

  assert.equal(mapCodexHookEvent({ ...payload, hook_event_name: "Stop" })?.status, "completed");
  assert.equal(
    mapCodexHookEvent({ ...payload, hook_event_name: "PermissionRequest" })?.status,
    "needs_authorization",
  );
  assert.equal(mapCodexHookEvent({ ...payload, hook_event_name: "Interrupt" })?.status, "interrupted");
});

test("钩子事件可追加写入本地 NDJSON 日志", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-task-reminder-events-"));
  const eventPath = join(directory, "events.ndjson");
  const event = mapCodexHookEvent({
    hook_event_name: "Stop",
    session_id: "session-2",
    turn_id: "turn-2",
  });

  assert.ok(event);
  await appendTaskEvent(event, eventPath);
  const lines = (await readFile(eventPath, "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).status, "completed");
});

test("各工作区的钩子默认写入同一个用户级事件日志", () => {
  assert.equal(
    defaultEventLogPath("C:\\Users\\tester\\AppData\\Roaming"),
    join("C:\\Users\\tester\\AppData\\Roaming", "CodexTaskReminder", "events.ndjson"),
  );
});

test("旧事件和旧偏好回退到 Codex", async () => {
  const event = validateTaskEvent(completedEvent);
  assert.equal(event.source, "codex");
  assert.match(event.eventId, /^codex:/);

  const directory = await mkdtemp(join(tmpdir(), "codex-task-reminder-legacy-preferences-"));
  const filePath = join(directory, "preferences.json");
  await writeFile(filePath, JSON.stringify({ mode: "light", soundEnabled: true }), "utf8");

  assert.deepEqual((await new JsonPreferencesStore(filePath).load()).enabledSources, {
    codex: true,
    antigravity: false,
    dsh: false,
  });
});

test("各 Agent 映射状态和稳定事件标识", () => {
  const codexStop = {
    hook_event_name: "Stop",
    session_id: "session-1",
    turn_id: "turn-1",
  };
  const antigravityStop = {
    hook_event_name: "Stop",
    session_id: "antigravity-session",
    turn_id: "antigravity-turn",
  };
  const dshCompleted = {
    event: "turn/end",
    session: { id: "dsh-session" },
    turn: { id: "dsh-turn" },
    reason: "completed",
  };
  const dshFailed = { ...dshCompleted, reason: "error" };

  assert.equal(mapAgentHookEvent("codex", codexStop)?.eventId, "codex:session-1:turn-1:Stop");
  assert.equal(mapAgentHookEvent("antigravity", antigravityStop)?.source, "antigravity");
  assert.equal(mapAgentHookEvent("dsh", dshCompleted)?.status, "completed");
  assert.equal(mapAgentHookEvent("dsh", dshFailed)?.status, "failed");
});
