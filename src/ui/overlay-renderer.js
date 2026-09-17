/**
 * 遮挡式全屏模态框 (Overlay) 渲染器
 * 负责在 codex-display-overlay 容器中渲染全屏毛玻璃与焦点卡片，提供快捷键交互
 */

export class OverlayRenderer {
  constructor(containerElement, options = {}) {
    this.container = containerElement;
    this.onAcknowledge = options.onAcknowledge || (() => {});
    this.onOpenTask = options.onOpenTask || (() => {});
    this.currentReminder = null;
    this.keyHandler = null;
  }

  render(presentation) {
    this.clear();

    this.currentReminder = presentation;

    const overlay = document.createElement("div");
    overlay.className = `reminder-overlay-backdrop tone-${presentation.visualTone}`;
    overlay.setAttribute("data-reminder-id", presentation.id);
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "reminder-overlay-title");

    const statusMap = {
      completed: { label: "任务已完成", icon: "✓", badge: "COMPLETED" },
      needs_input: { label: "等待用户输入", icon: "💬", badge: "INPUT REQUIRED" },
      needs_authorization: { label: "Codex 等待授权", icon: "🔐", badge: "PERMISSION REQUIRED" },
      failed: { label: "任务执行失败", icon: "✕", badge: "EXECUTION FAILED" },
      interrupted: { label: "任务已被中断", icon: "⚠️", badge: "INTERRUPTED" },
    };
    const statusInfo = statusMap[presentation.status] || {
      label: presentation.status,
      icon: "ℹ",
      badge: presentation.status.toUpperCase(),
    };

    overlay.innerHTML = `
      <div class="overlay-modal-card">
        <div class="overlay-modal-glow"></div>
        
        <div class="overlay-icon-container">
          <div class="overlay-icon-pulse"></div>
          <div class="overlay-icon-badge">${statusInfo.icon}</div>
        </div>

        <div class="overlay-badge-pill">
          <span class="status-indicator-dot"></span>
          <span class="badge-text">${statusInfo.badge}</span>
        </div>

        <h2 class="overlay-title" id="reminder-overlay-title">${escapeHtml(presentation.title)}</h2>
        <p class="overlay-summary">${escapeHtml(presentation.summary)}</p>

        <div class="overlay-task-meta">
          <span class="meta-label">Task ID</span>
          <code class="meta-code">${escapeHtml(presentation.taskId)}</code>
        </div>

        <div class="overlay-actions-row">
          <button class="overlay-btn-secondary btn-open-task" title="快捷键: O">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>
            <span>打开任务</span>
            <kbd class="key-hint">O</kbd>
          </button>
          
          <button class="overlay-btn-primary btn-acknowledge" title="快捷键: Enter 或 Space">
            <span>我知道了</span>
            <kbd class="key-hint">↵ Enter</kbd>
          </button>
        </div>
      </div>
    `;

    // 绑定点击事件
    const btnAcknowledge = overlay.querySelector(".btn-acknowledge");
    const btnOpenTask = overlay.querySelector(".btn-open-task");

    btnAcknowledge.addEventListener("click", () => {
      this.onAcknowledge(presentation.id);
    });

    btnOpenTask.addEventListener("click", () => {
      this.onOpenTask(presentation.id, presentation.taskId);
    });

    this.container.appendChild(overlay);

    // 弹簧动画入场
    requestAnimationFrame(() => {
      overlay.classList.add("enter-active");
      btnAcknowledge.focus();
    });

    // 注册全局键盘监听
    this.setupKeyboardShortcuts(presentation);
  }

  setupKeyboardShortcuts(presentation) {
    this.keyHandler = (e) => {
      // 正在输入表单文本时不阻断
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

      if (e.key === "Tab") {
        const focusable = [...this.container.querySelectorAll("button")];
        const currentIndex = focusable.indexOf(document.activeElement);
        const nextIndex = e.shiftKey ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1) : (currentIndex + 1) % focusable.length;
        e.preventDefault();
        focusable[nextIndex]?.focus();
      } else if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
        e.preventDefault();
        this.onAcknowledge(presentation.id);
      } else if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        this.onOpenTask(presentation.id, presentation.taskId);
      }
    };
    window.addEventListener("keydown", this.keyHandler);
  }

  remove(id) {
    if (!this.currentReminder || this.currentReminder.id !== id) return;

    if (this.keyHandler) {
      window.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }

    const overlay = this.container.querySelector(`[data-reminder-id="${id}"]`);
    if (overlay) {
      overlay.classList.remove("enter-active");
      overlay.classList.add("exit-active");
      overlay.addEventListener("transitionend", () => {
        overlay.remove();
      }, { once: true });
      setTimeout(() => overlay.remove(), 350);
    }

    this.currentReminder = null;
  }

  clear() {
    if (this.keyHandler) {
      window.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }
    this.container.innerHTML = "";
    this.currentReminder = null;
  }
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
