import { randomUUID } from "node:crypto";
import { validateTaskEvent } from "./events.ts";
import { decideReminder } from "./policy.ts";
import type {
  ReminderChange,
  ReminderDecision,
  ReminderListener,
  ReminderPreferences,
  ReminderPresentation,
  RuntimeContext,
} from "./types.ts";

export class ReminderService {
  private readonly activeReminders = new Map<string, ReminderPresentation>();
  private readonly listeners = new Set<ReminderListener>();
  private readonly preferences: ReminderPreferences;
  private readonly createReminderId: () => string;

  constructor(
    preferences: ReminderPreferences,
    createReminderId: () => string = randomUUID,
  ) {
    this.preferences = preferences;
    this.createReminderId = createReminderId;
  }

  receive(rawEvent: unknown, runtime: RuntimeContext): ReminderDecision {
    const event = validateTaskEvent(rawEvent);
    const decision = decideReminder(event, this.preferences, runtime, this.createReminderId);

    if (decision.kind === "display") {
      this.activeReminders.set(decision.presentation.id, decision.presentation);
      this.emit({ kind: "show", presentation: decision.presentation });
    }

    return decision;
  }

  subscribe(listener: ReminderListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  listActive(): ReminderPresentation[] {
    return [...this.activeReminders.values()];
  }

  acknowledge(reminderId: string): boolean {
    const reminder = this.activeReminders.get(reminderId);
    if (!reminder || !reminder.requiresAcknowledgement) {
      return false;
    }

    this.close(reminderId, "acknowledged");
    return true;
  }

  dismiss(reminderId: string): boolean {
    const reminder = this.activeReminders.get(reminderId);
    if (!reminder || reminder.requiresAcknowledgement) {
      return false;
    }

    this.close(reminderId, "dismissed");
    return true;
  }

  openTask(reminderId: string): string | undefined {
    return this.activeReminders.get(reminderId)?.taskId;
  }

  private close(reminderId: string, reason: Extract<ReminderChange, { kind: "close" }>['reason']): void {
    this.activeReminders.delete(reminderId);
    this.emit({ kind: "close", reminderId, reason });
  }

  private emit(change: ReminderChange): void {
    for (const listener of this.listeners) {
      listener(change);
    }
  }
}
