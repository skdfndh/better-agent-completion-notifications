import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateTaskEvent } from "../src/events.ts";
import { mapCodexHookEvent } from "../src/codex-hooks.ts";
import { appendTaskEvent, workspaceEventLogPath } from "../src/event-log.ts";
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
  const decision = decideReminder(event, DEFAULT_PREFERENCES, { isGameFullScreen: false }, () => "r-1");

  assert.equal(decision.kind, "display");
  if (decision.kind !== "display") return;
  assert.deepEqual(decision.presentation.dismissal, { kind: "automatic", afterMs: 5_000 });
  assert.equal(decision.presentation.location, "codex-display-bottom-right");
  assert.equal(decision.presentation.visualTone, "success");
});

test("特殊状态在轻提醒中持续显示并使用对应语义", () => {
  const event = validateTaskEvent({ ...completedEvent, status: "failed" });
  const decision = decideReminder(event, DEFAULT_PREFERENCES, { isGameFullScreen: false }, () => "r-2");

  assert.equal(decision.kind, "display");
  if (decision.kind !== "display") return;
  assert.deepEqual(decision.presentation.dismissal, { kind: "manual" });
  assert.equal(decision.presentation.visualTone, "error");
  assert.equal(decision.presentation.soundCue, "error");
});

test("隐藏模式和游戏全屏均不展示提醒", () => {
  const event = validateTaskEvent(completedEvent);
  const hidden = decideReminder(event, { ...DEFAULT_PREFERENCES, mode: "hidden" }, { isGameFullScreen: false }, () => "r-3");
  const game = decideReminder(event, DEFAULT_PREFERENCES, { isGameFullScreen: true }, () => "r-4");

  assert.deepEqual(hidden, { kind: "suppressed", reason: "hidden-mode" });
  assert.deepEqual(game, { kind: "suppressed", reason: "game-fullscreen" });
});

test("遮挡提醒必须通过确认关闭，未来 UI 可订阅操作结果", () => {
  const changes: string[] = [];
  const service = new ReminderService({ ...DEFAULT_PREFERENCES, mode: "blocking" }, () => "r-5");
  service.subscribe((change) => changes.push(change.kind));

  const decision = service.receive(completedEvent, { isGameFullScreen: false });
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

test("钩子可将事件写入触发任务的工作区", () => {
  assert.equal(
    workspaceEventLogPath("C:\\workspace"),
    join("C:\\workspace", ".codex", "codex-task-reminder", "events.ndjson"),
  );
});
