import { mapAgentHookEvent } from "./agent-adapters.ts";
import type { TaskEvent } from "./types.ts";

export function mapCodexHookEvent(payload: unknown, occurredAt = new Date().toISOString()): TaskEvent | undefined {
  return mapAgentHookEvent("codex", payload, occurredAt);
}
