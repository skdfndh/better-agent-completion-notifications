import { ReminderService, DEFAULT_PREFERENCES } from "./reminder-core.js";
import { ToastRenderer } from "./toast-renderer.js";
import { OverlayRenderer } from "./overlay-renderer.js";
import { soundEngine } from "./audio.js";

// 初始化应用状态与服务
const preferences = { ...DEFAULT_PREFERENCES };
let runtimeContext = { isGameFullScreen: false };

const toastContainer = document.getElementById("codex-display-bottom-right");
const overlayContainer = document.getElementById("codex-display-overlay");
const logTerminal = document.getElementById("log-terminal");
const activeCountEl = document.getElementById("active-count");
const currentModeLabel = document.getElementById("current-mode-label");
const streamStatusEl = document.getElementById("stream-status");

// 初始化提醒核心服务
const service = new ReminderService(preferences);

// 辅助日志输出
function appendLog(kind, title, detail) {
  if (!logTerminal) return;
  const item = document.createElement("div");
  item.className = `log-item log-${kind}`;
  const now = new Date().toLocaleTimeString();

  item.innerHTML = `
    <div class="log-meta">
      <span>[${now}] <strong>${kind.toUpperCase()}</strong></span>
      <span>${escapeHtml(title)}</span>
    </div>
    <div class="log-content">${escapeHtml(detail)}</div>
  `;

  logTerminal.insertBefore(item, logTerminal.firstChild);

  // 最多保留 30 条日志
  while (logTerminal.children.length > 30) {
    logTerminal.lastElementChild.remove();
  }
}

function updateActiveCount() {
  if (!activeCountEl) return;
  const count = service.listActive().length;
  activeCountEl.textContent = `${count} 个活跃提醒`;
}

// 渲染器实例化
const toastRenderer = new ToastRenderer(toastContainer, {
  onDismiss: (id) => {
    service.dismiss(id);
  },
  onOpenTask: (id, taskId) => {
    handleOpenTask(id, taskId);
  },
});

const overlayRenderer = new OverlayRenderer(overlayContainer, {
  onAcknowledge: (id) => {
    service.acknowledge(id);
  },
  onOpenTask: (id, taskId) => {
    handleOpenTask(id, taskId);
  },
});

async function handleOpenTask(reminderId, taskId) {
  const resolvedTaskId = service.openTask(reminderId) || taskId;
  const openTask = window.codexTaskReminderHost?.openTask;
  if (typeof openTask !== "function") {
    appendLog("open_task", "桌面宿主未连接", `无法打开任务：${resolvedTaskId}`);
    showFeedbackToast("桌面宿主未连接，暂时无法打开任务");
    return;
  }

  try {
    await openTask(resolvedTaskId);
    appendLog("open_task", "任务已交由桌面宿主打开", resolvedTaskId);
    showFeedbackToast("已交由桌面宿主打开任务");
  } catch {
    appendLog("open_task", "打开任务失败", resolvedTaskId);
    showFeedbackToast("桌面宿主未能打开任务");
  }
}

function setStreamStatus(connected) {
  if (!streamStatusEl) return;
  streamStatusEl.classList.toggle("inactive", !connected);
  streamStatusEl.querySelector("span:last-child").textContent = connected ? "事件流已连接" : "事件流未连接";
}

async function savePreferences() {
  const response = await fetch("/api/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(preferences),
  });
  if (!response.ok) throw new Error("保存提醒设置失败。");
}

async function loadPreferences() {
  try {
    const response = await fetch("/api/preferences");
    if (!response.ok) throw new Error("加载提醒设置失败。");
    const saved = await response.json();
    Object.assign(preferences, saved);
    service.updatePreferences(saved);
    document.querySelector(`.segmented-btn[data-mode="${saved.mode}"]`)?.click();
    if (soundToggle) soundToggle.checked = saved.soundEnabled;
    soundEngine.setEnabled(saved.soundEnabled);
  } catch {
    appendLog("system", "未加载持久化设置", "正在使用默认提醒设置。");
  }
}

function connectEventStream() {
  const stream = new EventSource("/api/events");
  stream.addEventListener("open", () => setStreamStatus(true));
  stream.addEventListener("error", () => setStreamStatus(false));
  stream.addEventListener("task", (message) => {
    try {
      dispatchEvent(JSON.parse(message.data));
    } catch {
      appendLog("error", "收到无效任务事件", "事件流数据已忽略。");
    }
  });
}

function showFeedbackToast(text) {
  const badge = document.createElement("div");
  badge.style.cssText = `
    position: fixed;
    top: 24px;
    left: 50%;
    transform: translateX(-50%) translateY(-10px);
    background: rgba(30, 41, 59, 0.95);
    border: 1px solid rgba(255,255,255,0.15);
    backdrop-filter: blur(12px);
    color: #38bdf8;
    padding: 8px 16px;
    border-radius: 9999px;
    font-size: 13px;
    font-weight: 500;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    z-index: 10001;
    opacity: 0;
    transition: all 0.25s ease;
  `;
  badge.textContent = text;
  document.body.appendChild(badge);
  
  requestAnimationFrame(() => {
    badge.style.opacity = "1";
    badge.style.transform = "translateX(-50%) translateY(0)";
  });

  setTimeout(() => {
    badge.style.opacity = "0";
    badge.style.transform = "translateX(-50%) translateY(-10px)";
    setTimeout(() => badge.remove(), 300);
  }, 2200);
}

// 订阅服务事件
service.subscribe((change) => {
  if (change.kind === "show") {
    const { presentation } = change;
    appendLog(
      "show",
      `[${presentation.mode}] ${presentation.title}`,
      `ID: ${presentation.id} | 状态: ${presentation.status} | 调性: ${presentation.visualTone}`
    );

    // 触发声音
    if (presentation.soundCue) {
      soundEngine.play(presentation.soundCue);
    }

    // 分发渲染
    if (presentation.location === "codex-display-bottom-right") {
      toastRenderer.render(presentation);
    } else if (presentation.location === "codex-display-overlay") {
      overlayRenderer.render(presentation);
    }
  } else if (change.kind === "close") {
    appendLog("close", `已关闭 ${change.reminderId}`, `原因: ${change.reason}`);
    toastRenderer.remove(change.reminderId);
    overlayRenderer.remove(change.reminderId);
  }

  updateActiveCount();
});

// 统一分发事件到 Service
function dispatchEvent(eventData) {
  const decision = service.receive(eventData, runtimeContext);
  if (decision.kind === "suppressed") {
    appendLog(
      "suppressed",
      `提醒已被抑制 (${decision.reason})`,
      `任务: ${eventData.title} | 当前模式: ${preferences.mode} | 游戏全屏: ${runtimeContext.isGameFullScreen}`
    );
  }
}

// 绑定预设状态模拟按钮
const presetButtons = document.querySelectorAll(".btn-preset");
presetButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const status = btn.getAttribute("data-status");
    const taskId = `task-${Date.now().toString(36).slice(-5)}`;
    
    const presetData = {
      completed: {
        title: "单元测试与模块构建已顺利完成",
        summary: "所有 9 个测试用例全部绿灯通过，构建产物已写入目标目录。",
      },
      needs_input: {
        title: "Codex 等待确认数据库重构脚本",
        summary: "检测到将要对 user_credentials 表进行字段迁移，请回复 Y 继续。",
      },
      needs_authorization: {
        title: "Codex 请求高危终端权限",
        summary: "Codex 正在尝试执行命令：git push --force origin main，等待管理员授权。",
      },
      failed: {
        title: "Docker 容器拉取依赖失败",
        summary: "网络连接重置导致未能成功拉取 registry.codex.internal/runtime 镜像。",
      },
      interrupted: {
        title: "Codex 任务轮次已被中断",
        summary: "检测到底层进程接收到 SIGINT 中断信号，执行流程已安全终止。",
      },
    };

    const data = presetData[status] || {
      title: `Codex 任务状态更新：${status}`,
      summary: "任务状态已发生变更。",
    };

    dispatchEvent({
      taskId,
      status,
      title: data.title,
      summary: data.summary,
      occurredAt: new Date().toISOString(),
    });
  });
});

// 绑定偏好设置：模式切换
const modeButtons = document.querySelectorAll(".segmented-btn[data-mode]");
modeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    modeButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    
    const newMode = btn.getAttribute("data-mode");
    preferences.mode = newMode;
    service.updatePreferences({ mode: newMode });
    
    if (currentModeLabel) {
      const modeText = { light: "轻提醒 (Light)", blocking: "遮挡式 (Blocking)", hidden: "隐藏 (Hidden)" };
      currentModeLabel.textContent = modeText[newMode] || newMode;
    }

    appendLog("setting", "修改提醒模式", `当前模式切换为：${newMode}`);
    savePreferences().catch(() => showFeedbackToast("提醒设置保存失败"));
  });
});

// 绑定偏好设置：声音开关
const soundToggle = document.getElementById("sound-toggle");
if (soundToggle) {
  soundToggle.addEventListener("change", (e) => {
    const enabled = e.target.checked;
    preferences.soundEnabled = enabled;
    service.updatePreferences({ soundEnabled: enabled });
    soundEngine.setEnabled(enabled);
    appendLog("setting", "修改声音提醒", `声音提示已${enabled ? "开启" : "关闭"}`);
    savePreferences().catch(() => showFeedbackToast("提醒设置保存失败"));
  });
}

// 绑定运行时：游戏全屏模式模拟
const gameToggle = document.getElementById("game-toggle");
if (gameToggle) {
  gameToggle.addEventListener("change", (e) => {
    const isGame = e.target.checked;
    runtimeContext.isGameFullScreen = isGame;
    appendLog("runtime", "游戏全屏状态", `游戏全屏模拟已${isGame ? "激活 (将静默所有提醒)" : "停用"}`);
  });
}

// 绑定声音试听
const audioButtons = document.querySelectorAll(".btn-audio-test");
audioButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const cue = btn.getAttribute("data-cue");
    soundEngine.play(cue);
  });
});

// 自定义表单提交
const customForm = document.getElementById("custom-event-form");
if (customForm) {
  customForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const titleInput = document.getElementById("custom-title");
    const summaryInput = document.getElementById("custom-summary");
    const statusSelect = document.getElementById("custom-status");

    const title = titleInput.value.trim() || "自定义任务事件";
    const summary = summaryInput.value.trim() || "无附加描述信息";
    const status = statusSelect.value;
    const taskId = `task-custom-${Date.now().toString(36).slice(-4)}`;

    dispatchEvent({
      taskId,
      status,
      title,
      summary,
      occurredAt: new Date().toISOString(),
    });
  });
}

// 清空日志
const btnClearLog = document.getElementById("btn-clear-log");
if (btnClearLog) {
  btnClearLog.addEventListener("click", () => {
    logTerminal.innerHTML = "";
    appendLog("system", "日志已清空", "等待接收新事件...");
  });
}

// 绑定独立弹窗预览窗口打开
const btnOpenPopup = document.getElementById("btn-open-popup-window");
if (btnOpenPopup) {
  btnOpenPopup.addEventListener("click", (e) => {
    e.preventDefault();
    const width = 450;
    const height = 320;
    const left = window.screen.availLeft + window.screen.availWidth - width - 24;
    const top = window.screen.availTop + window.screen.availHeight - height - 24;
    window.open(
      "popup.html",
      "codex_task_reminder_popup",
      `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`
    );
  });
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 初始输出引导日志
appendLog("system", "Codex 任务提醒系统就绪", "服务已订阅事件流，点击上方预设按钮即可测试各种状态提醒。");
updateActiveCount();
void loadPreferences();
connectEventStream();
