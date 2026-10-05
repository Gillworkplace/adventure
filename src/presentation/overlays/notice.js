import { dialog } from "./dialogs.js";

export const NOTICE_VERSION = "2026.09.25.1";
const STORAGE_KEY = "adventure.notice.dismissed_version";

export function isNoticeDismissed(version = NOTICE_VERSION) {
  try {
    return localStorage.getItem(STORAGE_KEY) === version;
  } catch {
    return false;
  }
}

export function dismissNotice(version = NOTICE_VERSION) {
  try {
    localStorage.setItem(STORAGE_KEY, version);
  } catch (error) {
    console.warn("Failed to save notice dismissal status:", error);
  }
}

export function showNotice({ onClose } = {}) {
  const existing = document.querySelector(".notice-dialog");
  if (existing) {
    existing.close();
    existing.remove();
  }

  const body = document.createElement("div");
  body.className = "notice-content";
  body.innerHTML = `
    <div class="notice-meta">
      <span class="notice-badge">v2 更新公告</span>
      <span class="notice-version">版本 ${NOTICE_VERSION}</span>
    </div>
    <div class="notice-body">
      <section class="notice-section">
        <div class="notice-section-header">
          <strong class="notice-title">辅助模式 (BETA)</strong>
        </div>
        <p class="notice-desc">
          通过屏幕共享实时自动识别实际游戏画面（持有卡牌、角色位置、进度），并推荐最佳的卡牌使用与骰子操作。
        </p>
      </section>

      <section class="notice-section">
        <div class="notice-section-header">
          <strong class="notice-title">Gemini AI 实时语音引导</strong>
        </div>
        <p class="notice-desc">
          用 4 种语言（韩语、英语、日语、中文）的男/女声 AI 语音生动播报推荐行动、卡牌使用与掷骰子。可在顶部 <strong>[语音]</strong> 菜单中设置声音与音量。
        </p>
      </section>

      <section class="notice-section">
        <div class="notice-section-header">
          <strong class="notice-title">自由切换模式 & 帮助</strong>
        </div>
        <p class="notice-desc">
          通过底部<strong>[切换模式]</strong>按钮可随时轻松切换<strong>手动 / 自动 / 辅助</strong>模式。点击左上角的喇叭图标可随时再次查看本公告。
        </p>
      </section>
    </div>
    <div class="notice-footer">
      <button type="button" class="notice-dismiss-button">不再显示</button>
      <button type="button" class="notice-confirm-button primary">确认</button>
    </div>
  `;

  const node = dialog("新功能介绍", body, { className: "notice-dialog" });

  let closedHandled = false;
  const handleClose = () => {
    if (closedHandled) return;
    closedHandled = true;
    if (typeof onClose === "function") onClose();
  };

  body.querySelector(".notice-dismiss-button").onclick = () => {
    dismissNotice(NOTICE_VERSION);
    node.close();
  };

  body.querySelector(".notice-confirm-button").onclick = () => {
    node.close();
  };

  node.addEventListener("close", handleClose, { once: true });

  return node;
}
