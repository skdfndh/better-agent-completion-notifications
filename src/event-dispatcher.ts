import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { appendTaskEvent, defaultEventLogPath, defaultRuntimeDirectory } from "./event-log.ts";
import { validateTaskEvent } from "./events.ts";
import { JsonPreferencesStore } from "./preferences.ts";
import type { TaskEvent } from "./types.ts";

const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const HIDDEN_LAUNCHER_PATH = join(SOURCE_DIRECTORY, "native", "reminder-hidden-launcher.vbs");
const NATIVE_HOST_PATH = join(SOURCE_DIRECTORY, "native", "reminder-host.ps1");

export type NativeLauncher = (eventPath: string) => Promise<void>;
export type DispatchResult =
  | { kind: "launched" }
  | { kind: "suppressed-source" }
  | { kind: "duplicate" };

export interface DispatchOptions {
  appDataPath?: string;
  preferencesStore?: JsonPreferencesStore;
  launch?: NativeLauncher;
}

function eventHash(event: TaskEvent): string {
  return createHash("sha256").update(`${event.source}\0${event.eventId}`).digest("hex");
}

async function removeExpiredClaims(directory: string, now = Date.now()): Promise<void> {
  try {
    const entries = await readdir(directory);
    await Promise.all(entries.map(async (entry) => {
      const path = join(directory, entry);
      try {
        if (now - (await stat(path)).mtimeMs > DEDUPE_WINDOW_MS) {
          await rm(path, { force: true });
        }
      } catch {
        // 其他进程可能在并发清理同一个声明，下一次分发会再次检查。
      }
    }));
  } catch {
    // 目录首次使用时尚不存在，后续创建声明会建立它。
  }
}

async function claimEvent(directory: string, event: TaskEvent): Promise<string | undefined> {
  await mkdir(directory, { recursive: true });
  await removeExpiredClaims(directory);
  const path = join(directory, eventHash(event));
  try {
    const file = await open(path, "wx");
    try {
      await file.writeFile(JSON.stringify({ source: event.source, eventId: event.eventId, claimedAt: new Date().toISOString() }));
    } finally {
      await file.close();
    }
    return path;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return undefined;
    throw error;
  }
}

async function launchNativeReminder(eventPath: string): Promise<void> {
  const child = spawn(
    "wscript.exe",
    [HIDDEN_LAUNCHER_PATH, "-File", NATIVE_HOST_PATH, "-EventPath", eventPath],
    { detached: true, windowsHide: true, stdio: "ignore" },
  );
  child.unref();
}

export async function dispatchTaskEvent(rawEvent: TaskEvent, options: DispatchOptions = {}): Promise<DispatchResult> {
  const event = validateTaskEvent(rawEvent);
  const appDataPath = options.appDataPath ?? process.env.APPDATA;
  const runtimeDirectory = defaultRuntimeDirectory(appDataPath);
  const preferencesStore = options.preferencesStore ?? new JsonPreferencesStore(join(runtimeDirectory, "preferences.json"));
  const preferences = await preferencesStore.load();
  await appendTaskEvent(event, defaultEventLogPath(appDataPath));

  if (!preferences.enabledSources[event.source]) {
    return { kind: "suppressed-source" };
  }

  const claimPath = await claimEvent(join(runtimeDirectory, "dedupe"), event);
  if (!claimPath) return { kind: "duplicate" };

  const pendingDirectory = join(runtimeDirectory, "pending");
  const eventPath = join(pendingDirectory, `${eventHash(event)}-${randomUUID()}.json`);
  try {
    await mkdir(dirname(eventPath), { recursive: true });
    await writeFile(eventPath, `${JSON.stringify(event)}\n`, "utf8");
    await (options.launch ?? launchNativeReminder)(eventPath);
    return { kind: "launched" };
  } catch (error) {
    await Promise.all([
      rm(eventPath, { force: true }),
      rm(claimPath, { force: true }),
    ]);
    throw error;
  }
}
