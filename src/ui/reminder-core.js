/**
 * Codex 任务提醒核心 - 浏览器运行适配
 * 与 Node.js 端规则和数据结构 1:1 保持一致
 */

export const TASK_STATUSES = [
  "completed",
  "needs_input",
  "needs_authorization",
  "failed",
  "interrupted",
];

const SPECIAL_STATUSES = [
  "needs_input",
  "needs_authorization",
  "failed",
  "interrupted",
];

export const DEFAULT_PREFERENCES = {
  mode: "light",
  soundEnabled: true,
};

function visualToneFor(status) {
  if (status === "completed") return "success";
  if (status === "needs_input" || status === "needs_authorization") return "attention";
  return "error";
}

function soundCueFor(status) {
  const tone = visualToneFor(status);
  return tone === "success" ? "completed" : tone === "attention" ? "attention" : "error";
}

function fallbackSummary(status) {
  const summaries = {
    completed: "任务已完成。",
    needs_input: "任务等待你的输入。",
    needs_authorization: "任务等待你的授权。",
    failed: "任务执行失败。",
    interrupted: "任务已中断。",
  };
  return summaries[status] || "任务状态已更新。";
}

export function validateTaskEvent(value) {
  if (typeof value !== "object" || value === null) {
    throw new Error("任务事件必须是对象。");
  }

  const requireText = (val, field) => {
    if (typeof val !== "string" || val.trim().length === 0) {
      throw new Error(`任务事件的 ${field} 必须是非空字符串。`);
    }
    return val.trim();
  };

  const taskId = requireText(value.taskId, "taskId");
  const title = requireText(value.title, "title");
  const occurredAt = requireText(value.occurredAt, "occurredAt");
  const occurredDate = new Date(occurredAt);

  if (Number.isNaN(occurredDate.getTime())) {
    throw new Error("任务事件的 occurredAt 必须是有效时间。");
  }

  const status = requireText(value.status, "status");
  if (!TASK_STATUSES.includes(status)) {
    throw new Error(`不支持的任务状态：${status}。`);
  }

  if (value.summary !== undefined && typeof value.summary !== "string") {
    throw new Error("任务事件的 summary 必须是字符串。");
  }

  return {
    taskId,
    title,
    occurredAt: occurredDate.toISOString(),
    status,
    ...(value.summary?.trim() ? { summary: value.summary.trim() } : {}),
  };
}

export function decideReminder(event, preferences, runtime, createReminderId) {
  if (runtime.isGameFullScreen) {
    return { kind: "suppressed", reason: "game-fullscreen" };
  }

  if (preferences.mode === "hidden") {
    return { kind: "suppressed", reason: "hidden-mode" };
  }

  const isBlocking = preferences.mode === "blocking";
  const isSpecial = SPECIAL_STATUSES.includes(event.status);

  const presentation = {
    id: createReminderId(),
    taskId: event.taskId,
    mode: preferences.mode,
    location: isBlocking ? "codex-display-overlay" : "codex-display-bottom-right",
    title: event.title,
    status: event.status,
    summary: event.summary ?? fallbackSummary(event.status),
    visualTone: visualToneFor(event.status),
    ...(preferences.soundEnabled ? { soundCue: soundCueFor(event.status) } : {}),
    dismissal: isBlocking || isSpecial ? { kind: "manual" } : { kind: "automatic", afterMs: 5000 },
    requiresAcknowledgement: isBlocking,
    actions: isBlocking ? ["acknowledge", "open_task"] : ["dismiss", "open_task"],
  };

  return { kind: "display", presentation };
}

export class ReminderService {
  constructor(preferences = DEFAULT_PREFERENCES, createReminderId = () => crypto.randomUUID()) {
    this.preferences = { ...preferences };
    this.createReminderId = createReminderId;
    this.activeReminders = new Map();
    this.listeners = new Set();
  }

  updatePreferences(newPrefs) {
    this.preferences = { ...this.preferences, ...newPrefs };
  }

  getPreferences() {
    return { ...this.preferences };
  }

  receive(rawEvent, runtime = { isGameFullScreen: false }) {
    const event = validateTaskEvent(rawEvent);
    const decision = decideReminder(event, this.preferences, runtime, this.createReminderId);

    if (decision.kind === "display") {
      this.activeReminders.set(decision.presentation.id, decision.presentation);
      this.emit({ kind: "show", presentation: decision.presentation });
    }

    return decision;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  listActive() {
    return Array.from(this.activeReminders.values());
  }

  acknowledge(reminderId) {
    const reminder = this.activeReminders.get(reminderId);
    if (!reminder || !reminder.requiresAcknowledgement) {
      return false;
    }
    this.close(reminderId, "acknowledged");
    return true;
  }

  dismiss(reminderId) {
    const reminder = this.activeReminders.get(reminderId);
    if (!reminder || reminder.requiresAcknowledgement) {
      return false;
    }
    this.close(reminderId, "dismissed");
    return true;
  }

  openTask(reminderId) {
    return this.activeReminders.get(reminderId)?.taskId;
  }

  close(reminderId, reason) {
    if (this.activeReminders.has(reminderId)) {
      this.activeReminders.delete(reminderId);
      this.emit({ kind: "close", reminderId, reason });
    }
  }

  emit(change) {
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch (err) {
        console.error('[ReminderService] Listener error:', err);
      }
    }
  }
}
