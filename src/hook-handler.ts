import { mapCodexHookEvent } from "./codex-hooks.ts";
import { appendTaskEvent } from "./event-log.ts";

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

const rawInput = await readStandardInput();

function resolveEventLogPath(): string | undefined {
  return process.env.CODEX_TASK_REMINDER_EVENTS_PATH;
}

try {
  const payload = JSON.parse(rawInput) as unknown;
  const event = mapCodexHookEvent(payload);
  if (event) {
    await appendTaskEvent(event, resolveEventLogPath());
  }
} catch {
  // 钩子失败不能干扰 Codex 的正常生命周期。
}
