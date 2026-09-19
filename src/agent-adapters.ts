import type { AgentSource, TaskEvent, TaskStatus } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function nestedText(payload: Record<string, unknown>, key: string, nestedKey: string): string | undefined {
  const nested = payload[key];
  return isRecord(nested) ? text(nested[nestedKey]) : undefined;
}

function createEvent(
  source: AgentSource,
  sessionId: string,
  turnId: string,
  eventName: string,
  status: TaskStatus,
  title: string,
  summary: string,
  occurredAt: string,
): TaskEvent {
  return {
    taskId: sessionId,
    sessionId,
    eventId: `${source}:${sessionId}:${turnId}:${eventName}`,
    source,
    status,
    title,
    summary,
    occurredAt,
  };
}

function mapStandardHook(source: Exclude<AgentSource, "dsh">, payload: Record<string, unknown>, occurredAt: string): TaskEvent | undefined {
  const hookEventName = text(payload.hook_event_name);
  const sessionId = text(payload.session_id);
  const turnId = text(payload.turn_id);
  if (!hookEventName || !sessionId || !turnId) return undefined;

  const labels = source === "codex"
    ? {
      Stop: ["completed", "Codex 任务轮次已结束", "Codex 已结束当前任务轮次。"],
      PermissionRequest: ["needs_authorization", "Codex 等待授权", "Codex 正在等待你的授权。"],
      Interrupt: ["interrupted", "Codex 任务已中断", "Codex 当前任务轮次已被中断。"],
    }
    : {
      Stop: ["completed", "Antigravity 任务轮次已结束", "Antigravity 已结束当前任务轮次。"],
      PermissionRequest: ["needs_authorization", "Antigravity 等待授权", "Antigravity 正在等待你的授权。"],
      Interrupt: ["interrupted", "Antigravity 任务已中断", "Antigravity 当前任务轮次已被中断。"],
    };
  const mapped = labels[hookEventName as keyof typeof labels];
  if (!mapped) return undefined;

  return createEvent(source, sessionId, turnId, hookEventName, mapped[0] as TaskStatus, mapped[1], mapped[2], occurredAt);
}

function mapDshHook(payload: Record<string, unknown>, occurredAt: string): TaskEvent | undefined {
  const eventName = text(payload.event);
  const sessionId = nestedText(payload, "session", "id");
  const turnId = nestedText(payload, "turn", "id");
  if (!eventName || !sessionId || !turnId) return undefined;

  if (eventName === "turn/end") {
    const reason = text(payload.reason);
    const statusByReason: Record<string, TaskStatus> = {
      completed: "completed",
      error: "failed",
      failed: "failed",
      aborted: "interrupted",
      interrupted: "interrupted",
    };
    const status = reason ? statusByReason[reason] : undefined;
    if (!status) return undefined;
    const title = status === "completed" ? "DSH 任务轮次已结束" : status === "failed" ? "DSH 任务执行失败" : "DSH 任务已中断";
    const summary = status === "completed" ? "DSH 已结束当前任务轮次。" : status === "failed" ? "DSH 当前任务轮次执行失败。" : "DSH 当前任务轮次已中断。";
    return createEvent("dsh", sessionId, turnId, `${eventName}:${reason}`, status, title, summary, occurredAt);
  }

  if (eventName === "approval/asked") {
    return createEvent("dsh", sessionId, turnId, eventName, "needs_authorization", "DSH 等待授权", "DSH 正在等待你的授权。", occurredAt);
  }

  if (eventName === "agent/error") {
    return createEvent("dsh", sessionId, turnId, eventName, "failed", "DSH 任务执行失败", "DSH 当前任务轮次执行失败。", occurredAt);
  }

  return undefined;
}

export function mapAgentHookEvent(source: AgentSource, payload: unknown, occurredAt = new Date().toISOString()): TaskEvent | undefined {
  if (!isRecord(payload)) return undefined;
  return source === "dsh"
    ? mapDshHook(payload, occurredAt)
    : mapStandardHook(source, payload, occurredAt);
}
