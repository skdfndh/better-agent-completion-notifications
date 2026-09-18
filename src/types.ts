export const TASK_STATUSES = [
  "completed",
  "needs_input",
  "needs_authorization",
  "failed",
  "interrupted",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskEvent {
  taskId: string;
  status: TaskStatus;
  title: string;
  occurredAt: string;
  summary?: string;
}

export type ReminderMode = "blocking" | "light" | "hidden";

export interface ReminderPreferences {
  mode: ReminderMode;
  soundEnabled: boolean;
  workbenchServiceEnabled: boolean;
}

export interface RuntimeContext {
  isGameFullScreen: boolean;
}

export type VisualTone = "success" | "attention" | "error";
export type SoundCue = "completed" | "attention" | "error";

export type DismissalPolicy =
  | { kind: "automatic"; afterMs: number }
  | { kind: "manual" };

export type ReminderAction = "acknowledge" | "dismiss" | "open_task";

export interface ReminderPresentation {
  id: string;
  taskId: string;
  mode: Exclude<ReminderMode, "hidden">;
  location: "codex-display-bottom-right" | "codex-display-overlay";
  title: string;
  status: TaskStatus;
  summary: string;
  visualTone: VisualTone;
  soundCue?: SoundCue;
  dismissal: DismissalPolicy;
  requiresAcknowledgement: boolean;
  actions: ReminderAction[];
}

export type ReminderDecision =
  | { kind: "display"; presentation: ReminderPresentation }
  | { kind: "suppressed"; reason: "hidden-mode" | "game-fullscreen" };

export type ReminderChange =
  | { kind: "show"; presentation: ReminderPresentation }
  | { kind: "close"; reminderId: string; reason: "acknowledged" | "dismissed" };

export type ReminderListener = (change: ReminderChange) => void;
