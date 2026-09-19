import { pathToFileURL } from "node:url";
import { JsonPreferencesStore } from "./preferences.ts";
import { AGENT_SOURCES, type AgentSource, type ReminderPreferences } from "./types.ts";

export interface SetAgentSourceEnabledOptions {
  filePath?: string;
}

export async function setAgentSourceEnabled(
  source: AgentSource,
  enabled: boolean,
  options: SetAgentSourceEnabledOptions = {},
): Promise<ReminderPreferences> {
  if (!(AGENT_SOURCES as readonly string[]).includes(source)) {
    throw new Error("无效的任务提醒来源。");
  }

  const store = new JsonPreferencesStore(options.filePath);
  const preferences = await store.load();
  const updated = {
    ...preferences,
    enabledSources: {
      ...preferences.enabledSources,
      [source]: enabled,
    },
  };
  await store.save(updated);
  return updated;
}

function parseCliArguments(argumentsAfterScript: string[]): { source: AgentSource; enabled: boolean } {
  const sourceIndex = argumentsAfterScript.indexOf("--source");
  const enabledIndex = argumentsAfterScript.indexOf("--enabled");
  const source = sourceIndex === -1 ? undefined : argumentsAfterScript[sourceIndex + 1];
  const enabled = enabledIndex === -1 ? undefined : argumentsAfterScript[enabledIndex + 1];
  if (!(AGENT_SOURCES as readonly string[]).includes(source ?? "") || (enabled !== "true" && enabled !== "false")) {
    throw new Error("用法：--source codex|antigravity|dsh --enabled true|false");
  }
  return { source: source as AgentSource, enabled: enabled === "true" };
}

async function runCli(): Promise<void> {
  const { source, enabled } = parseCliArguments(process.argv.slice(2));
  await setAgentSourceEnabled(source, enabled);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : "无法更新任务提醒来源设置。");
    process.exitCode = 1;
  });
}
