import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PREFERENCES, ReminderService } from "../src/ui/reminder-core.js";

const event = {
  taskId: "antigravity-task",
  source: "antigravity",
  status: "completed",
  title: "可选来源测试",
  occurredAt: "2026-09-19T00:00:00.000Z",
};

test("浏览器预览会抑制已关闭的 Agent 来源", () => {
  const service = new ReminderService({
    ...DEFAULT_PREFERENCES,
    enabledSources: { codex: true, antigravity: false, dsh: false },
  });

  assert.deepEqual(service.receive(event), { kind: "suppressed", reason: "source-disabled" });
  assert.deepEqual(service.listActive(), []);
});

test("浏览器预览将未标记来源的旧事件视为 Codex", () => {
  const service = new ReminderService(DEFAULT_PREFERENCES, () => "preview-1");
  const result = service.receive({ ...event, source: undefined });

  assert.equal(result.kind, "display");
  if (result.kind === "display") {
    assert.equal(result.presentation.taskId, event.taskId);
  }
});
