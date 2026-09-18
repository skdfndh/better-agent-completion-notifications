import {
  type ReminderDecision,
  type ReminderPreferences,
  type ReminderPresentation,
  type RuntimeContext,
  type SoundCue,
  type TaskEvent,
  type TaskStatus,
  type VisualTone,
} from "./types.ts";

const SPECIAL_STATUSES: readonly TaskStatus[] = [
  "needs_input",
  "needs_authorization",
  "failed",
  "interrupted",
];

function visualToneFor(status: TaskStatus): VisualTone {
  if (status === "completed") {
    return "success";
  }

  if (status === "needs_input" || status === "needs_authorization") {
    return "attention";
  }

  return "error";
}

function soundCueFor(status: TaskStatus): SoundCue {
  return visualToneFor(status) === "success"
    ? "completed"
    : visualToneFor(status) === "attention"
      ? "attention"
      : "error";
}

function fallbackSummary(status: TaskStatus): string {
  const summaries: Record<TaskStatus, string> = {
    completed: "任务已完成。",
    needs_input: "任务等待你的输入。",
    needs_authorization: "任务等待你的授权。",
    failed: "任务执行失败。",
    interrupted: "任务已中断。",
  };

  return summaries[status];
}

export function decideReminder(
  event: TaskEvent,
  preferences: ReminderPreferences,
  runtime: RuntimeContext,
  createReminderId: () => string,
): ReminderDecision {
  if (preferences.mode === "hidden") {
    return { kind: "suppressed", reason: "hidden-mode" };
  }

  if (runtime.isFullScreen || runtime.isGameFullScreen) {
    if (preferences.fullscreenReminderMode === "disabled") {
      return { kind: "suppressed", reason: "fullscreen-disabled" };
    }

    if (preferences.fullscreenReminderMode === "sound_only") {
      return preferences.soundEnabled
        ? { kind: "sound-only", soundCue: soundCueFor(event.status) }
        : { kind: "sound-only" };
    }
  }

  const isBlocking = preferences.mode === "blocking";
  const isSpecial = SPECIAL_STATUSES.includes(event.status);
  const presentation: ReminderPresentation = {
    id: createReminderId(),
    taskId: event.taskId,
    mode: preferences.mode,
    location: isBlocking ? "codex-display-overlay" : "codex-display-bottom-right",
    title: event.title,
    status: event.status,
    summary: event.summary ?? fallbackSummary(event.status),
    visualTone: visualToneFor(event.status),
    ...(preferences.soundEnabled ? { soundCue: soundCueFor(event.status) } : {}),
    dismissal: isBlocking || isSpecial ? { kind: "manual" } : { kind: "automatic", afterMs: 5_000 },
    requiresAcknowledgement: isBlocking,
    actions: isBlocking ? ["acknowledge", "open_task"] : ["dismiss", "open_task"],
  };

  return { kind: "display", presentation };
}
