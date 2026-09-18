import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FullscreenReminderMode, ReminderMode, ReminderPreferences } from "./types.ts";

export const DEFAULT_PREFERENCES: ReminderPreferences = {
  mode: "light",
  soundEnabled: true,
  workbenchServiceEnabled: true,
  fullscreenReminderMode: "normal",
};

const REMINDER_MODES: readonly ReminderMode[] = ["blocking", "light", "hidden"];
const FULLSCREEN_REMINDER_MODES: readonly FullscreenReminderMode[] = ["normal", "sound_only", "disabled"];

function normalizePreferences(value: unknown): ReminderPreferences | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (!(
    typeof candidate.mode === "string" &&
    REMINDER_MODES.includes(candidate.mode as ReminderMode) &&
    typeof candidate.soundEnabled === "boolean"
  )) {
    return undefined;
  }

  return {
    mode: candidate.mode as ReminderMode,
    soundEnabled: candidate.soundEnabled,
    workbenchServiceEnabled: typeof candidate.workbenchServiceEnabled === "boolean"
      ? candidate.workbenchServiceEnabled
      : DEFAULT_PREFERENCES.workbenchServiceEnabled,
    fullscreenReminderMode: typeof candidate.fullscreenReminderMode === "string" &&
      FULLSCREEN_REMINDER_MODES.includes(candidate.fullscreenReminderMode as FullscreenReminderMode)
      ? candidate.fullscreenReminderMode as FullscreenReminderMode
      : DEFAULT_PREFERENCES.fullscreenReminderMode,
  };
}

export function defaultPreferencesPath(appData = process.env.APPDATA): string {
  return join(appData ?? process.cwd(), "CodexTaskReminder", "preferences.json");
}

export class JsonPreferencesStore {
  private readonly filePath: string;

  constructor(filePath = defaultPreferencesPath()) {
    this.filePath = filePath;
  }

  async load(): Promise<ReminderPreferences> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      return normalizePreferences(parsed) ?? DEFAULT_PREFERENCES;
    } catch {
      return DEFAULT_PREFERENCES;
    }
  }

  async save(preferences: ReminderPreferences): Promise<void> {
    if (!normalizePreferences(preferences)) {
      throw new Error("提醒设置无效。");
    }

    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(preferences, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.filePath);
  }
}
