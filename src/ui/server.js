import { createServer } from "node:http";
import { unwatchFile, watchFile } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultEventLogPath } from "../event-log.ts";
import { validateTaskEvent } from "../events.ts";
import { JsonPreferencesStore } from "../preferences.ts";

const UI_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_PORT = 3300;
const EVENT_POLL_INTERVAL_MS = 500;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

function resolvePort(value = process.env.PORT) {
  if (!value) return DEFAULT_PORT;

  const port = Number.parseInt(value, 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_PORT;
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function sendNotFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("404 Not Found");
}

function safeStaticFilePath(pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }

  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^[/\\]+/, "");
  const filePath = resolve(UI_DIRECTORY, relativePath);
  const pathFromRoot = relative(UI_DIRECTORY, filePath);

  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    return undefined;
  }

  return filePath;
}

export function resolveEventLogPath({ eventLogPath = process.env.CODEX_TASK_REMINDER_EVENTS_PATH } = {}) {
  return eventLogPath || defaultEventLogPath();
}

export class NdjsonEventStreamer {
  constructor(eventLogPath, onEvent, intervalMs = EVENT_POLL_INTERVAL_MS) {
    this.eventLogPath = eventLogPath;
    this.onEvent = onEvent;
    this.intervalMs = intervalMs;
    this.offset = 0;
    this.pending = Buffer.alloc(0);
    this.reading = false;
    this.started = false;
    this.onFileChange = () => {
      void this.readAppendedEvents();
    };
  }

  async start() {
    if (this.started) return;

    this.started = true;
    try {
      this.offset = (await stat(this.eventLogPath)).size;
    } catch {
      this.offset = 0;
    }

    watchFile(this.eventLogPath, { interval: this.intervalMs }, this.onFileChange);
  }

  stop() {
    if (!this.started) return;

    unwatchFile(this.eventLogPath, this.onFileChange);
    this.started = false;
    this.pending = Buffer.alloc(0);
  }

  async readAppendedEvents() {
    if (this.reading) return;

    this.reading = true;
    try {
      while (true) {
        let size;
        try {
          size = (await stat(this.eventLogPath)).size;
        } catch {
          return;
        }

        if (size < this.offset) {
          this.offset = 0;
          this.pending = Buffer.alloc(0);
        }

        if (size === this.offset) return;

        const bytesToRead = size - this.offset;
        const file = await open(this.eventLogPath, "r");
        const content = Buffer.alloc(bytesToRead);
        try {
          const { bytesRead } = await file.read(content, 0, bytesToRead, this.offset);
          this.offset += bytesRead;
          this.consumeLines(content.subarray(0, bytesRead));
        } finally {
          await file.close();
        }
      }
    } catch {
      // 日志写入短暂失败时等待下一次文件变更，避免中断已连接的工作台。
    } finally {
      this.reading = false;
    }
  }

  consumeLines(chunk) {
    const combined = Buffer.concat([this.pending, chunk]);
    let lineStart = 0;

    for (let index = 0; index < combined.length; index += 1) {
      if (combined[index] !== 0x0a) continue;

      const line = combined.subarray(lineStart, index).toString("utf8").replace(/\r$/, "").trim();
      lineStart = index + 1;
      if (!line) continue;

      try {
        this.onEvent(validateTaskEvent(JSON.parse(line)));
      } catch {
        // 单条损坏日志不能阻塞后续事件。
      }
    }

    this.pending = combined.subarray(lineStart);
  }
}

function readRequestBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 16 * 1024) {
        rejectBody(new Error("请求体过大。"));
      }
    });
    req.on("end", () => resolveBody(body));
    req.on("error", rejectBody);
  });
}

async function serveStaticFile(pathname, res) {
  const filePath = safeStaticFilePath(pathname);
  if (!filePath) {
    sendNotFound(res);
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      sendNotFound(res);
      return;
    }

    const contentType = MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream";
    const content = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    });
    res.end(content);
  } catch {
    sendNotFound(res);
  }
}

export async function createReminderUiServer(options = {}) {
  const eventLogPath = resolveEventLogPath(options);
  const preferencesStore = options.preferencesStore ?? new JsonPreferencesStore(options.preferencesPath);
  const clients = new Set();
  const broadcast = (event) => {
    const payload = `event: task\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) {
      if (client.writableEnded || client.destroyed) {
        clients.delete(client);
      } else {
        client.write(payload);
      }
    }
  };
  const streamer = new NdjsonEventStreamer(eventLogPath, broadcast, options.eventPollIntervalMs);

  const server = createServer(async (req, res) => {
    const requestUrl = new URL(req.url ?? "/", `http://${LOOPBACK_HOST}`);

    if (requestUrl.pathname === "/api/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      res.write("retry: 2000\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (requestUrl.pathname === "/api/preferences" && req.method === "GET") {
      sendJson(res, 200, await preferencesStore.load());
      return;
    }

    if (requestUrl.pathname === "/api/preferences" && req.method === "PUT") {
      try {
        const rawBody = await readRequestBody(req);
        const preferences = JSON.parse(rawBody);
        await preferencesStore.save(preferences);
        sendJson(res, 200, preferences);
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : "提醒设置无效。" });
      }
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD, PUT" });
      res.end();
      return;
    }

    await serveStaticFile(requestUrl.pathname, res);
  });

  server.once("close", () => streamer.stop());
  await streamer.start();

  return { server, eventLogPath, streamer };
}

export async function startReminderUiServer(options = {}) {
  const application = await createReminderUiServer(options);
  const port = options.port ?? resolvePort();

  await new Promise((resolveListen, rejectListen) => {
    application.server.once("error", rejectListen);
    application.server.listen(port, LOOPBACK_HOST, resolveListen);
  });

  console.log("\n======================================================");
  console.log(" Codex Task Reminder 前端控制台已启动");
  console.log(` 访问地址: http://${LOOPBACK_HOST}:${port}`);
  console.log(` 监听事件: ${application.eventLogPath}`);
  console.log(" 按 Ctrl+C 停止服务");
  console.log("======================================================\n");

  return application;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void startReminderUiServer().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
