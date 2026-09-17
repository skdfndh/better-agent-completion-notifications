import { mapCodexHookEvent } from "./codex-hooks.ts";
import { appendTaskEvent, workspaceEventLogPath } from "./event-log.ts";

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

const rawInput = await readStandardInput();

function resolveEventLogPath(payload: unknown): string | undefined {
  if (process.env.CODEX_TASK_REMINDER_EVENTS_PATH) {
    return process.env.CODEX_TASK_REMINDER_EVENTS_PATH;
  }

  if (typeof payload === "object" && payload !== null && "cwd" in payload) {
    const cwd = payload.cwd;
    if (typeof cwd === "string" && cwd.length > 0) {
      return workspaceEventLogPath(cwd);
    }
  }

  return undefined;
}

try {
  const payload = JSON.parse(rawInput) as unknown;
  const event = mapCodexHookEvent(payload);
  if (event) {
    await appendTaskEvent(event, resolveEventLogPath(payload));
  }
} catch {
  // 钩子失败不能干扰 Codex 的正常生命周期。
}
