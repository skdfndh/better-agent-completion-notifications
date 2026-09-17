import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ReminderMode, ReminderPreferences } from "./types.ts";

export const DEFAULT_PREFERENCES: ReminderPreferences = {
  mode: "light",
  soundEnabled: true,
};

const REMINDER_MODES: readonly ReminderMode[] = ["blocking", "light", "hidden"];

function isPreferences(value: unknown): value is ReminderPreferences {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.mode === "string" &&
    REMINDER_MODES.includes(candidate.mode as ReminderMode) &&
    typeof candidate.soundEnabled === "boolean"
  );
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
      return isPreferences(parsed) ? parsed : DEFAULT_PREFERENCES;
    } catch {
      return DEFAULT_PREFERENCES;
    }
  }

  async save(preferences: ReminderPreferences): Promise<void> {
    if (!isPreferences(preferences)) {
      throw new Error("提醒设置无效。");
    }

    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(preferences, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.filePath);
  }
}
