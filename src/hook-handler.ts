import { mapAgentHookEvent } from "./agent-adapters.ts";
import { dispatchTaskEvent } from "./event-dispatcher.ts";
import { AGENT_SOURCES, type AgentSource } from "./types.ts";

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function resolveSource(argumentsAfterScript: string[]): AgentSource {
  const sourceIndex = argumentsAfterScript.indexOf("--source");
  const source = sourceIndex === -1 ? "codex" : argumentsAfterScript[sourceIndex + 1];
  if (!(AGENT_SOURCES as readonly string[]).includes(source)) {
    throw new Error("无效的任务提醒来源。");
  }
  return source as AgentSource;
}

try {
  const rawInput = await readStandardInput();
  const payload = JSON.parse(rawInput) as unknown;
  const source = resolveSource(process.argv.slice(2));
  const event = mapAgentHookEvent(source, payload);
  if (event) {
    await dispatchTaskEvent(event);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "任务提醒分发失败。");
  process.exitCode = 1;
}
