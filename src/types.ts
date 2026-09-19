export const TASK_STATUSES = [
  "completed",
  "needs_input",
  "needs_authorization",
  "failed",
  "interrupted",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export const AGENT_SOURCES = ["codex", "antigravity", "dsh"] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];
export type EnabledSources = Record<AgentSource, boolean>;

export interface TaskEvent {
  taskId: string;
  eventId: string;
  source: AgentSource;
  status: TaskStatus;
  title: string;
  occurredAt: string;
  summary?: string;
  sessionId?: string;
}

export type ReminderMode = "blocking" | "light" | "hidden";
export type FullscreenReminderMode = "normal" | "sound_only" | "disabled";

export interface ReminderPreferences {
  mode: ReminderMode;
  soundEnabled: boolean;
  workbenchServiceEnabled: boolean;
  fullscreenReminderMode: FullscreenReminderMode;
  enabledSources: EnabledSources;
}

export interface RuntimeContext {
  isFullScreen?: boolean;
  isGameFullScreen?: boolean;
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
  | { kind: "sound-only"; soundCue?: SoundCue }
  | { kind: "suppressed"; reason: "hidden-mode" | "fullscreen-disabled" };

export type ReminderChange =
  | { kind: "show"; presentation: ReminderPresentation }
  | { kind: "close"; reminderId: string; reason: "acknowledged" | "dismissed" };

export type ReminderListener = (change: ReminderChange) => void;
