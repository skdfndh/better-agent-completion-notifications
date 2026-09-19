import { AGENT_SOURCES, TASK_STATUSES, type AgentSource, type TaskEvent, type TaskStatus } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`任务事件的 ${field} 必须是非空字符串。`);
  }

  return value.trim();
}

function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

function isAgentSource(value: string): value is AgentSource {
  return (AGENT_SOURCES as readonly string[]).includes(value);
}

export function validateTaskEvent(value: unknown): TaskEvent {
  if (!isRecord(value)) {
    throw new Error("任务事件必须是对象。");
  }

  const taskId = requireText(value.taskId, "taskId");
  const title = requireText(value.title, "title");
  const occurredAt = requireText(value.occurredAt, "occurredAt");
  const occurredDate = new Date(occurredAt);

  if (Number.isNaN(occurredDate.getTime())) {
    throw new Error("任务事件的 occurredAt 必须是有效时间。");
  }

  const status = requireText(value.status, "status");
  if (!isTaskStatus(status)) {
    throw new Error(`不支持的任务状态：${status}。`);
  }

  if (value.summary !== undefined && typeof value.summary !== "string") {
    throw new Error("任务事件的 summary 必须是字符串。");
  }

  const sourceValue = value.source === undefined ? "codex" : requireText(value.source, "source");
  if (!isAgentSource(sourceValue)) {
    throw new Error(`不支持的任务来源：${sourceValue}。`);
  }

  const normalizedOccurredAt = occurredDate.toISOString();
  const eventId = value.eventId === undefined
    ? `${sourceValue}:${taskId}:${status}:${normalizedOccurredAt}`
    : requireText(value.eventId, "eventId");

  if (value.sessionId !== undefined && typeof value.sessionId !== "string") {
    throw new Error("任务事件的 sessionId 必须是字符串。");
  }

  return {
    taskId,
    eventId,
    source: sourceValue,
    title,
    occurredAt: normalizedOccurredAt,
    status,
    ...(value.summary?.trim() ? { summary: value.summary.trim() } : {}),
    ...(value.sessionId?.trim() ? { sessionId: value.sessionId.trim() } : {}),
  };
}
