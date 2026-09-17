import type { TaskEvent, TaskStatus } from "./types.ts";

interface HookPayload {
  hook_event_name?: unknown;
  session_id?: unknown;
  turn_id?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function createEvent(
  payload: HookPayload,
  status: TaskStatus,
  title: string,
  summary: string,
  occurredAt: string,
): TaskEvent | undefined {
  const sessionId = requiredText(payload.session_id);
  const turnId = requiredText(payload.turn_id);
  if (!sessionId || !turnId) {
    return undefined;
  }

  return {
    taskId: sessionId,
    status,
    title,
    summary,
    occurredAt,
  };
}

export function mapCodexHookEvent(payload: unknown, occurredAt = new Date().toISOString()): TaskEvent | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const hookEventName = requiredText(payload.hook_event_name);
  if (!hookEventName) {
    return undefined;
  }

  if (hookEventName === "Stop") {
    return createEvent(
      payload,
      "completed",
      "Codex 任务轮次已结束",
      "Codex 已结束当前任务轮次。",
      occurredAt,
    );
  }

  if (hookEventName === "PermissionRequest") {
    return createEvent(
      payload,
      "needs_authorization",
      "Codex 等待授权",
      "Codex 正在等待你的授权。",
      occurredAt,
    );
  }

  if (hookEventName === "Interrupt") {
    return createEvent(
      payload,
      "interrupted",
      "Codex 任务已中断",
      "Codex 当前任务轮次已被中断。",
      occurredAt,
    );
  }

  return undefined;
}
