import assert from "node:assert/strict";
import test from "node:test";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NdjsonEventStreamer, resolveEventLogPath } from "../src/ui/server.js";

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

test("显式事件日志覆盖工作台默认位置", () => {
  const path = resolveEventLogPath({ eventLogPath: "C:\\CodexTaskReminder\\custom-events.ndjson" });
  assert.equal(path, "C:\\CodexTaskReminder\\custom-events.ndjson");
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

test("工作台提供全屏媒体提醒三档设置", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-reminder-fullscreen-ui-"));
  const eventLogPath = join(directory, "events.ndjson");
  const { createReminderUiServer } = await import("../src/ui/server.js");
  const app = await createReminderUiServer({ eventLogPath });
  const server = app.server;
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 3300;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    const html = await response.text();
    assert.match(html, /全屏媒体提醒/);
    assert.match(html, /data-fullscreen-mode="sound_only"/);
    assert.match(html, /data-fullscreen-mode="disabled"/);
  } finally {
    await new Promise((res) => server.close(res));
    await rm(directory, { recursive: true, force: true });
  }
});

test("工作台提供可选 Agent 来源开关", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-reminder-agent-sources-ui-"));
  const { createReminderUiServer } = await import("../src/ui/server.js");
  const app = await createReminderUiServer({ eventLogPath: join(directory, "events.ndjson") });
  await new Promise((resolveListen) => app.server.listen(0, "127.0.0.1", resolveListen));
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 3300;
  try {
    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    assert.match(html, /data-source="codex"/);
    assert.match(html, /data-source="antigravity"/);
    assert.match(html, /data-source="dsh"/);
  } finally {
    await new Promise((resolveClose) => app.server.close(resolveClose));
    await rm(directory, { recursive: true, force: true });
  }
});
