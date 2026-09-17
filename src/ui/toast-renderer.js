/**
 * 轻提醒 (Toast) 渲染器
 * 负责在 codex-display-bottom-right 容器中渲染卡片、处理倒计时、悬停暂停及关闭动效
 */

export class ToastRenderer {
  constructor(containerElement, options = {}) {
    this.container = containerElement;
    this.onDismiss = options.onDismiss || (() => {});
    this.onOpenTask = options.onOpenTask || (() => {});
    this.activeToasts = new Map(); // id -> { element, timer, remainingMs, startTime, isPaused }
  }

  render(presentation) {
    // 如果已存在则更新或移除重建
    if (this.activeToasts.has(presentation.id)) {
      this.remove(presentation.id);
    }

    const card = document.createElement("div");
    card.className = `reminder-toast-card tone-${presentation.visualTone}`;
    card.setAttribute("data-reminder-id", presentation.id);

    const statusMap = {
      completed: { label: "任务完成", icon: "✓" },
      needs_input: { label: "等待输入", icon: "💬" },
      needs_authorization: { label: "等待授权", icon: "🔐" },
      failed: { label: "执行失败", icon: "✕" },
      interrupted: { label: "已中断", icon: "⚠️" },
    };
    const statusInfo = statusMap[presentation.status] || { label: presentation.status, icon: "ℹ" };

    const isAutoDismiss = presentation.dismissal?.kind === "automatic";
    const duration = isAutoDismiss ? presentation.dismissal.afterMs : 0;

    card.innerHTML = `
      <div class="toast-glow-aura"></div>
      <div class="toast-content-wrapper">
        <div class="toast-header-row">
          <div class="toast-status-pill">
            <span class="status-indicator-dot"></span>
            <span class="status-indicator-text">${statusInfo.label}</span>
          </div>
          <span class="toast-timestamp">刚刚</span>
          <button class="toast-btn-icon btn-close" title="关闭提醒" aria-label="关闭">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div class="toast-body">
          <h4 class="toast-title" title="${escapeHtml(presentation.title)}">${escapeHtml(presentation.title)}</h4>
          <p class="toast-summary">${escapeHtml(presentation.summary)}</p>
        </div>

        <div class="toast-actions-row">
          <button class="toast-btn-action btn-open-task" data-task-id="${escapeHtml(presentation.taskId)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>
            <span>打开任务</span>
          </button>
          <button class="toast-btn-action btn-dismiss-text">知道了</button>
        </div>
      </div>
      ${isAutoDismiss ? `<div class="toast-progress-bar-container"><div class="toast-progress-bar"></div></div>` : ""}
    `;

    // 绑定事件
    const btnClose = card.querySelector(".btn-close");
    const btnDismissText = card.querySelector(".btn-dismiss-text");
    const btnOpenTask = card.querySelector(".btn-open-task");

    const handleDismiss = () => this.onDismiss(presentation.id);
    btnClose.addEventListener("click", handleDismiss);
    btnDismissText.addEventListener("click", handleDismiss);

    btnOpenTask.addEventListener("click", () => {
      this.onOpenTask(presentation.id, presentation.taskId);
    });

    this.container.appendChild(card);

    // 弹簧入场
    requestAnimationFrame(() => {
      card.classList.add("enter-active");
    });

    // 倒计时管理
    if (isAutoDismiss) {
      this.setupAutoDismiss(presentation.id, card, duration);
    } else {
      this.activeToasts.set(presentation.id, { element: card });
    }
  }

  setupAutoDismiss(id, card, duration) {
    const progressBar = card.querySelector(".toast-progress-bar");
    let remainingMs = duration;
    let startTime = Date.now();
    let isPaused = false;
    let timerId = null;

    if (progressBar) {
      progressBar.style.transition = `transform ${duration}ms linear`;
      requestAnimationFrame(() => {
        progressBar.style.transform = "scaleX(0)";
      });
    }

    const scheduleTimer = (ms) => {
      clearTimeout(timerId);
      timerId = setTimeout(() => {
        this.onDismiss(id);
      }, ms);
    };

    scheduleTimer(duration);

    // 鼠标悬停暂停倒计时
    card.addEventListener("mouseenter", () => {
      if (isPaused) return;
      isPaused = true;
      clearTimeout(timerId);
      const elapsed = Date.now() - startTime;
      remainingMs = Math.max(0, remainingMs - elapsed);

      if (progressBar) {
        const computedWidthRatio = remainingMs / duration;
        progressBar.style.transition = "none";
        progressBar.style.transform = `scaleX(${computedWidthRatio})`;
      }
    });

    card.addEventListener("mouseleave", () => {
      if (!isPaused) return;
      isPaused = false;
      startTime = Date.now();
      if (progressBar) {
        progressBar.style.transition = `transform ${remainingMs}ms linear`;
        requestAnimationFrame(() => {
          progressBar.style.transform = "scaleX(0)";
        });
      }
      scheduleTimer(remainingMs);
    });

    this.activeToasts.set(id, {
      element: card,
      timerId,
      clear() {
        clearTimeout(timerId);
      },
    });
  }

  remove(id) {
    const toast = this.activeToasts.get(id);
    if (!toast) return;

    if (toast.clear) {
      toast.clear();
    }

    const { element } = toast;
    element.classList.remove("enter-active");
    element.classList.add("exit-active");

    element.addEventListener("transitionend", () => {
      element.remove();
    }, { once: true });

    // 超时保底移除
    setTimeout(() => {
      element.remove();
    }, 400);

    this.activeToasts.delete(id);
  }

  clearAll() {
    for (const [id] of this.activeToasts) {
      this.remove(id);
    }
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
