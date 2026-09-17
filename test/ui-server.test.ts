import assert from "node:assert/strict";
import test from "node:test";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NdjsonEventStreamer, resolveWorkspaceEventLogPath } from "../src/ui/server.js";

test("事件监听器只转发新增且有效的 NDJSON 事件", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-reminder-ui-"));
  const eventLogPath = join(directory, "events.ndjson");
  const received: unknown[] = [];
  const streamer = new NdjsonEventStreamer(eventLogPath, (event) => received.push(event), 20);

  try {
    await appendFile(eventLogPath, "{\\\"taskId\\\":\\\"old\\\"}\n", "utf8");
    await streamer.start();
    await appendFile(eventLogPath, "not-json\n", "utf8");
    await appendFile(eventLogPath, `${JSON.stringify({ taskId: "task-1", title: "测试任务", status: "completed", occurredAt: "2026-09-17T00:00:00.000Z" })}\n`, "utf8");
    await new Promise((resolveWait) => setTimeout(resolveWait, 120));
    assert.equal(received.length, 1);
  } finally {
    streamer.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("显式工作区决定事件日志位置", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-reminder-workspace-"));
  try {
    const path = await resolveWorkspaceEventLogPath({ workspacePath: directory });
    assert.equal(path, join(directory, ".codex", "codex-task-reminder", "events.ndjson"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("UI 服务器能够正确托管独立弹窗 popup.html 与 popup.js", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-reminder-ui-test-"));
  const eventLogPath = join(directory, "events.ndjson");
  const { createReminderUiServer } = await import("../src/ui/server.js");

  const app = await createReminderUiServer({ eventLogPath });
  const server = app.server;
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 3300;

  try {
    const resHtml = await fetch(`http://127.0.0.1:${port}/popup.html`);
    assert.equal(resHtml.status, 200);
    assert.match(resHtml.headers.get("content-type") || "", /text\/html/);
    const htmlText = await resHtml.text();
    assert.match(htmlText, /Codex 任务提醒 - 弹窗/);
    assert.match(htmlText, /codex-display-bottom-right/);

    const resJs = await fetch(`http://127.0.0.1:${port}/popup.js`);
    assert.equal(resJs.status, 200);
    assert.match(resJs.headers.get("content-type") || "", /javascript/);
  } finally {
    await new Promise((res) => server.close(res));
    await rm(directory, { recursive: true, force: true });
  }
});

