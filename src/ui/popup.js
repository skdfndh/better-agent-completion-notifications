import { ReminderService, DEFAULT_PREFERENCES } from "./reminder-core.js";
import { ToastRenderer } from "./toast-renderer.js";
import { OverlayRenderer } from "./overlay-renderer.js";
import { soundEngine } from "./audio.js";

const preferences = { ...DEFAULT_PREFERENCES };
let runtimeContext = { isGameFullScreen: false };

const toastContainer = document.getElementById("codex-display-bottom-right");
const overlayContainer = document.getElementById("codex-display-overlay");
const standbyEl = document.getElementById("popup-standby");
const statusTextEl = document.getElementById("popup-status-text");

const service = new ReminderService(preferences);

function updateStandbyState() {
  if (!standbyEl) return;
  const count = service.listActive().length;
  if (count > 0) {
    standbyEl.style.opacity = "0";
    standbyEl.style.pointerEvents = "none";
  } else {
    standbyEl.style.opacity = "1";
    standbyEl.style.pointerEvents = "auto";
  }
}

async function handleOpenTask(reminderId, taskId) {
  const resolvedTaskId = service.openTask(reminderId) || taskId;
  const openTask = window.codexTaskReminderHost?.openTask;
  if (typeof openTask === "function") {
    try {
      await openTask(resolvedTaskId);
    } catch {
      // 忽略或使用通知
    }
  } else {
    // 复制 Task ID 并给用户提示
    try {
      await navigator.clipboard.writeText(resolvedTaskId);
      showPopupNotice(`已复制任务 ID: ${resolvedTaskId}`);
    } catch {
      showPopupNotice(`任务 ID: ${resolvedTaskId}`);
    }
  }
}

function showPopupNotice(text) {
  const badge = document.createElement("div");
  badge.className = "popup-flash-notice";
  badge.textContent = text;
  document.body.appendChild(badge);
  requestAnimationFrame(() => badge.classList.add("active"));
  setTimeout(() => {
    badge.classList.remove("active");
    setTimeout(() => badge.remove(), 250);
  }, 2000);
}

// 实例化渲染器
const toastRenderer = new ToastRenderer(toastContainer, {
  onDismiss: (id) => service.dismiss(id),
  onOpenTask: (id, taskId) => handleOpenTask(id, taskId),
});

const overlayRenderer = new OverlayRenderer(overlayContainer, {
  onAcknowledge: (id) => service.acknowledge(id),
  onOpenTask: (id, taskId) => handleOpenTask(id, taskId),
});

service.subscribe((change) => {
  if (change.kind === "show") {
    const { presentation } = change;
    if (presentation.soundCue) {
      soundEngine.play(presentation.soundCue);
    }
    if (presentation.location === "codex-display-bottom-right") {
      toastRenderer.render(presentation);
    } else if (presentation.location === "codex-display-overlay") {
      overlayRenderer.render(presentation);
    }
  } else if (change.kind === "close") {
    toastRenderer.remove(change.reminderId);
    overlayRenderer.remove(change.reminderId);
  }
  updateStandbyState();
});

function dispatchEvent(eventData) {
  service.receive(eventData, runtimeContext);
}

// 连接事件流
function connectEventStream() {
  const stream = new EventSource("/api/events");
  stream.addEventListener("open", () => {
    if (statusTextEl) statusTextEl.textContent = "已连接 Codex 提醒事件流";
    if (standbyEl) standbyEl.classList.remove("disconnected");
  });
  stream.addEventListener("error", () => {
    if (statusTextEl) statusTextEl.textContent = "事件流重连中...";
    if (standbyEl) standbyEl.classList.add("disconnected");
  });
  stream.addEventListener("task", (message) => {
    try {
      dispatchEvent(JSON.parse(message.data));
    } catch {
      // 容错处理
    }
  });
}

// 支持 URL 参数模拟或直接渲染单个事件
function parseUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get("status");
  const title = params.get("title");
  const summary = params.get("summary");
  const mode = params.get("mode");

  if (mode && ["light", "blocking", "hidden"].includes(mode)) {
    preferences.mode = mode;
    service.updatePreferences({ mode });
  }

  if (status && title) {
    setTimeout(() => {
      dispatchEvent({
        taskId: params.get("taskId") || `task-url-${Date.now().toString(36).slice(-4)}`,
        status,
        title,
        summary: summary || "",
        occurredAt: new Date().toISOString(),
      });
    }, 100);
  }
}

async function loadPreferences() {
  try {
    const response = await fetch("/api/preferences");
    if (response.ok) {
      const saved = await response.json();
      Object.assign(preferences, saved);
      service.updatePreferences(saved);
      soundEngine.setEnabled(saved.soundEnabled);
    }
  } catch {
    // 使用默认偏好
  }
}

void loadPreferences().then(() => {
  parseUrlParams();
  connectEventStream();
  updateStandbyState();
});
