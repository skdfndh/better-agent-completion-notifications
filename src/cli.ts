import { readFile } from "node:fs/promises";
import { ReminderService } from "./reminder-service.ts";
import { DEFAULT_PREFERENCES } from "./preferences.ts";

async function loadEvent(path?: string): Promise<unknown> {
  if (!path) {
    return {
      taskId: "demo-task",
      status: "completed",
      title: "示例 Codex 任务",
      summary: "提醒核心已生成可供 UI 展示的模型。",
      occurredAt: new Date().toISOString(),
    };
  }

  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

const argumentsAfterScript = process.argv.slice(2);
const eventFile = argumentsAfterScript.find((argument) => argument !== "--game-fullscreen");
const event = await loadEvent(eventFile);
const service = new ReminderService(DEFAULT_PREFERENCES);
service.subscribe((change) => console.log(JSON.stringify(change, null, 2)));

const decision = service.receive(event, {
  isGameFullScreen: argumentsAfterScript.includes("--game-fullscreen"),
});

console.log(JSON.stringify(decision, null, 2));
