import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonPreferencesStore } from "../src/preferences.ts";
import { dispatchTaskEvent } from "../src/event-dispatcher.ts";

const event = {
  taskId: "task-1",
  eventId: "event-1",
  source: "codex" as const,
  status: "completed" as const,
  title: "带有 空格、中文 和 \"引号\" 的任务",
  summary: "这段摘要不应出现在启动参数中。",
  occurredAt: "2026-09-19T00:00:00.000Z",
};

async function createRuntime() {
  const directory = await mkdtemp(join(tmpdir(), "codex-task-reminder-dispatcher-"));
  return {
    directory,
    preferencesStore: new JsonPreferencesStore(join(directory, "preferences.json")),
  };
}

test("首次事件写审计日志、创建一次性文件且不泄漏正文到参数", async () => {
  const { directory, preferencesStore } = await createRuntime();
  const launches: string[] = [];

  try {
    const result = await dispatchTaskEvent(event, {
      appDataPath: directory,
      preferencesStore,
      launch: async (eventPath) => launches.push(eventPath),
    });

    assert.equal(result.kind, "launched");
    assert.equal(launches.length, 1);
    assert.equal(launches[0].includes(event.title), false);
    assert.equal(launches[0].includes(event.summary), false);
    assert.equal(launches[0].endsWith(".json"), true);
    assert.deepEqual(JSON.parse(await readFile(launches[0], "utf8")), event);
    assert.deepEqual(
      JSON.parse((await readFile(join(directory, "CodexTaskReminder", "events.ndjson"), "utf8")).trim()),
      event,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("并发重复事件只取得一个声明", async () => {
  const { directory, preferencesStore } = await createRuntime();
  const launches: string[] = [];

  try {
    const results = await Promise.all(Array.from({ length: 8 }, () => dispatchTaskEvent(event, {
      appDataPath: directory,
      preferencesStore,
      launch: async (eventPath) => launches.push(eventPath),
    })));

    assert.equal(results.filter((item) => item.kind === "launched").length, 1);
    assert.equal(results.filter((item) => item.kind === "duplicate").length, 7);
    assert.equal(launches.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("禁用来源时不会启动一次性展示器", async () => {
  const { directory, preferencesStore } = await createRuntime();
  let launched = false;
  await preferencesStore.save({
    mode: "light",
    soundEnabled: true,
    workbenchServiceEnabled: true,
    fullscreenReminderMode: "normal",
    enabledSources: { codex: true, antigravity: false, dsh: false },
  });

  try {
    const result = await dispatchTaskEvent({ ...event, source: "antigravity", eventId: "agent-event" }, {
      appDataPath: directory,
      preferencesStore,
      launch: async () => { launched = true; },
    });

    assert.deepEqual(result, { kind: "suppressed-source" });
    assert.equal(launched, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("展示器启动失败后会释放声明以允许重试", async () => {
  const { directory, preferencesStore } = await createRuntime();

  try {
    await assert.rejects(() => dispatchTaskEvent(event, {
      appDataPath: directory,
      preferencesStore,
      launch: async () => { throw new Error("launcher failed"); },
    }), /launcher failed/);

    const result = await dispatchTaskEvent(event, {
      appDataPath: directory,
      preferencesStore,
      launch: async () => {},
    });
    assert.deepEqual(result, { kind: "launched" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("分发前会清理超过十分钟的声明", async () => {
  const { directory, preferencesStore } = await createRuntime();
  const dedupeDirectory = join(directory, "CodexTaskReminder", "dedupe");
  const stalePath = join(dedupeDirectory, "stale");

  try {
    await mkdir(dedupeDirectory, { recursive: true });
    await writeFile(stalePath, "stale", "utf8");
    await utimes(stalePath, new Date("2020-01-01T00:00:00.000Z"), new Date("2020-01-01T00:00:00.000Z"));

    await dispatchTaskEvent({ ...event, eventId: "fresh-event" }, {
      appDataPath: directory,
      preferencesStore,
      launch: async () => {},
    });

    assert.equal((await readdir(dedupeDirectory)).includes("stale"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
