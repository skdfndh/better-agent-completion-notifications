import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TaskEvent } from "./types.ts";

export function defaultEventLogPath(appData = process.env.APPDATA): string {
  return join(appData ?? process.cwd(), "CodexTaskReminder", "events.ndjson");
}

export async function appendTaskEvent(event: TaskEvent, filePath = defaultEventLogPath()): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
}
