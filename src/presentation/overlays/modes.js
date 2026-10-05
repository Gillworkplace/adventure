import { dialog, toast } from "./dialogs.js";
import { showVoiceSettings } from "./voice.js";

const icons = {
  assist: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4M7 9h3m4 4h3"/>',
  manual: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z"/>',
  automatic: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
const names = { assist: "辅助", manual: "手动", automatic: "自动" };
const connectionLabels = {
  idle: "请连接画面", requesting: "正在选择画面", connected: "画面已连接",
  paused: "画面已暂停", disconnected: "连接已断开",
};
const issues = {
  insecure: "屏幕共享只能在 HTTPS 地址或本地服务器上使用。",
  unsupported: "此浏览器无法使用屏幕共享。请在电脑上支持屏幕共享的浏览器中打开。",
  cancelled: "未连接画面。请重新选择，或检查浏览器的共享权限。",
  missing: "没有可共享的画面。请打开游戏窗口后重新连接。",
  capture: "无法获取画面。请检查游戏窗口和浏览器的屏幕共享权限。",
  "recognition-support": "此浏览器无法使用画面识别。请在最新的电脑浏览器中打开。",
  preview: "无法播放预览。请重新连接画面。",
};

export function showModes(session, assist, { screen = false, voice = null } = {}) {
  if (document.querySelector("dialog")) return;
  const body = document.createElement("div");
  const node = dialog("模式选择", body, { className: "mode-dialog" });
  let pane, video, previewIssue = false;
  const heading = node.querySelector("h2");
  const close = node.close.bind(node);
  node.close = () => { assist.cancelPending(); close(); };
  node.addEventListener("cancel", event => { event.preventDefault(); node.close(); });

  function releasePreview() {
    if (!video) return;
    video.pause();
    video.srcObject = null;
    video = null;
    previewIssue = false;
  }

  function choose(mode) {
    if (mode === "assist") { showScreen(); return; }
    session.execute("mode", mode);
    node.close();
    toast(`已切换到${names[mode]}模式。`);
  }

  function showChoices() {
    assist.cancelPending();
    releasePreview();
    pane = "choices";
    heading.textContent = "模式选择";
    body.innerHTML = `
      <p class="mode-intro">想以哪种方式游玩？</p>
      <div class="mode-options">
        ${[
          ["assist", "读取游戏画面，自动更新状态与推荐", "实际游戏请自行操作。"],
          ["manual", "手动输入实际游戏的结果", ""],
          ["automatic", "按实际游戏规则直接游玩", "不会代替你操作实际游戏。"],
        ].map(([mode, description, note]) => `
          <button type="button" class="mode-choice" data-mode="${mode}" ${session.mode === mode ? 'aria-current="true"' : ""}>
            <span class="mode-icon">${icon(mode)}</span>
            <span class="mode-copy"><strong>${names[mode]}${mode === "assist" ? '<span class="mode-beta">BETA</span>' : ""}${session.mode === mode ? '<span class="mode-current">使用中</span>' : ""}</strong>
            <span>${description}</span>${note ? `<small>${note}</small>` : ""}</span>
            <span class="mode-arrow" aria-hidden="true">›</span>
          </button>`).join("")}
      </div>
      <p class="mode-preserve">切换模式后，当前位置·骰子·卡牌仍会保留。</p>`;
    body.querySelectorAll("[data-mode]").forEach(button => {
      button.onclick = () => choose(button.dataset.mode);
    });
    (body.querySelector('[aria-current="true"]') || body.querySelector("button")).focus({ preventScroll: true });
  }

  function showScreen() {
    releasePreview();
    pane = "screen";
    heading.innerHTML = `辅助 <span class="mode-beta">BETA</span>`;
    body.innerHTML = `
      <button type="button" class="mode-back">‹ 模式选择</button>
      <div class="assist-heading"><strong role="status" class="assist-connection"></strong><span>画面预览</span></div>
      <div class="assist-preview">
        <video autoplay muted playsinline disablepictureinpicture aria-label="共享中的游戏画面" hidden></video>
        <div class="assist-placeholder">${icon("assist")}<strong></strong><span>请选择一个游戏窗口。</span></div>
        <span class="assist-paused" hidden>画面已暂停。</span>
      </div>
      <p class="assist-availability">会读取分数·骰子·手牌并反映到推荐中。需要确认时会在画面上方提示你。</p>
      <p class="assist-issue" role="status" hidden></p>
      <details class="assist-guide">
        <summary>画面连接指南</summary>
        <ol>
          <li><strong>选择游戏窗口</strong><span>点击“连接画面”，选择游戏所在的窗口或标签页。请将游戏窗口保持原始大小显示，不要最小化。不会共享声音。</span></li>
          <li><strong>画面确认</strong><span>请确保当前格·骰子使用次数·持有卡牌不被遮挡。从中间开始时，请打开实际游戏的卡牌获取记录，并从上到下慢慢滚动。</span></li>
          <li><strong>连接管理</strong><span>小预览窗口可以拖动移动或折叠。关闭此窗口后共享仍会继续。点击“断开连接”或切换到其他模式会结束共享，原有游戏状态会保留。</span></li>
        </ol>
      </details>
      <p class="assist-privacy">所选画面只在此浏览器中查看，不会录制或传输。</p>
      <footer><button type="button" class="primary" data-connect>连接画面</button><button type="button" data-rescan hidden>重新确认牌堆</button><button type="button" data-disconnect hidden>断开连接</button><button type="button" data-manual>切换到手动</button></footer>`;
    video = body.querySelector("video");
    body.querySelector(".mode-back").onclick = showChoices;
    body.querySelector("[data-connect]").onclick = async () => {
      if (await assist.connect()) {
        if (voice && !voice.enabled) node.addEventListener("close", () => showVoiceSettings(voice), { once: true });
        node.close();
      }
    };
    body.querySelector("[data-rescan]").onclick = () => { assist.rescan(); node.close(); };
    body.querySelector("[data-disconnect]").onclick = () => assist.disconnect();
    body.querySelector("[data-manual]").onclick = () => choose("manual");
    updateScreen();
    (body.querySelector("[data-connect]:not(:disabled)") || body.querySelector("[data-manual]")).focus({ preventScroll: true });
  }

  function updateScreen() {
    if (pane !== "screen" || !node.open) return;
    const { status, stream, support } = assist;
    const requesting = status === "requesting";
    const changedSource = video.srcObject !== stream;
    if (changedSource) previewIssue = false;
    body.querySelector(".assist-connection").textContent = support.available ? connectionLabels[status] : "不支持屏幕共享";
    body.querySelector(".assist-heading").dataset.status = status;
    body.querySelector(".assist-preview").hidden = !support.available;
    const connect = body.querySelector("[data-connect]");
    connect.disabled = requesting || !support.available;
    connect.textContent = requesting ? "正在选择画面…" : stream ? "更换画面" : session.mode === "assist" ? "重新连接" : "连接画面";
    body.querySelector("[data-disconnect]").hidden = !stream;
    body.querySelector("[data-rescan]").hidden = !stream;
    const placeholder = body.querySelector(".assist-placeholder");
    placeholder.hidden = !!stream && !previewIssue;
    placeholder.querySelector("strong").textContent = previewIssue ? "无法显示预览" : requesting ? "请选择要共享的画面" : status === "disconnected" ? "画面连接已断开" : !support.available ? "无法使用屏幕共享" : "请连接要一起查看的画面";
    placeholder.querySelector("span").hidden = requesting || !support.available || previewIssue;
    body.querySelector(".assist-paused").hidden = status !== "paused";
    const issue = !support.available ? support.issue : assist.issue || (previewIssue ? "preview" : null);
    const message = body.querySelector(".assist-issue");
    message.hidden = !issue;
    message.textContent = issues[issue] || "";
    video.hidden = !stream || previewIssue;
    if (changedSource) {
      const target = video;
      target.srcObject = stream;
      if (stream) target.play().catch(() => {
        if (video !== target || target.srcObject !== stream || !node.open) return;
        previewIssue = true;
        updateScreen();
      });
    }
  }

  assist.addEventListener("change", updateScreen);
  node.addEventListener("close", () => {
    assist.removeEventListener("change", updateScreen);
    releasePreview();
  }, { once: true });
  if (screen) showScreen(); else showChoices();
  return node;
}
