import { dialog, toast } from "./dialogs.js";
import { showModes } from "./modes.js";
import { cardLabels } from "../../content/cards.js";
import { cards } from "../../rules/index.js";
import { cardClass } from "../../application/assist-tracker.js";
import { showVoiceSettings } from "./voice.js";

const fields = { score: "当前格", dice: "骰子使用次数", hand: "持有卡牌", bonus: "骰子按钮" };
function guidance(assist, duration) {
  const r = assist.reading;
  if (!assist.stream) return ["画面连接已断开", "重新连接后会从当前状态开始确认。"];
  if (assist.status === "paused" || r.issue === "stale") return ["游戏画面已暂停", "请重新显示共享中的窗口。"];
  if (r.ready) return ["请继续游玩", r.deckOpen ? "已确认卡牌记录。可以关闭记录窗口了。" : "会读取画面变化并反映到状态和推荐中。"];
  if (r.issue === "reader") return ["无法开始画面识别", "请在连接管理中重新连接画面。"];
  if (r.issue === "window") return ["请展示完整的游戏窗口", "需要能看到当前格以及画面下方的骰子使用次数·卡牌。"];
  if (r.issue === "small") return ["请把游戏窗口再放大一些", "小字难以识别。请将游戏窗口恢复为原始大小显示。"];
  if (r.issue === "covered") return ["正在检查游戏画面", duration > 6000 ? "如果打开了弹窗，请关闭后继续。" : "操作结束后会自动继续。"];
  if (r.issue === "deck-open" || r.issue === "deck-reopen") return [r.issue === "deck-reopen" ? "请重新打开卡牌获取记录" : "请打开卡牌获取记录",
    r.verification === "gap" ? "检测到遗漏的变化，将重新确认剩余卡牌。" : "请点击实际游戏的 ? 按钮后，慢慢滚动列表。"];
  if (r.issue === "deck-up" || r.issue === "deck-down") return [`请将卡牌记录向${r.issue === "deck-up" ? "上" : "下"}滚动`, "部分卡牌尚未看到。滚动后请稍作停留。"];
  if (r.issue === "deck-scan") return ["请慢慢滚动卡牌记录", "正在确认列表位置。请稍微移动后停留片刻。"];
  if (r.issue === "deck-adjust" || r.issue === "deck-hold" && duration > 1800) return ["请将卡牌记录上下稍微移动", "还有未读取的条目。看到勾选标记时请稍作停留。"];
  if (r.issue === "deck-hold") return ["请暂停滚动", "正在确认当前可见的卡牌记录。"];
  if (fields[r.issue] && duration > 2500) return [`${fields[r.issue]}需要确认`, "请移开遮挡的窗口或光标。如果仍然困难，可以手动输入。"];
  return ["正在检查画面", "操作结束后会更新状态和推荐。"];
}

function showCorrection(assist) {
  if (document.querySelector("dialog")) return;
  const original = assist.tracker.lastObservation;
  if (!original?.visible) return;
  const stream = assist.stream, state = assist.session.state, body = document.createElement("form");
  body.className = "assist-correction";
  body.innerHTML = `<p>请按实际游戏中显示的数值进行修正。</p>
    <div class="assist-fields"><label>当前格<input name="position" type="number" min="1" max="2898" required></label>
    <label>骰子使用次数<input name="diceUsed" type="number" min="0" max="100" required></label></div>
    <label class="assist-double"><input type="checkbox" name="bonusRoll"> 双骰状态 <small>骰子按钮呈蓝色</small></label>
    <fieldset><legend>持有卡牌 <small>从左到右依次选择</small></legend><div class="assist-hand-inputs"></div></fieldset>
    <p class="assist-form-error" role="alert" hidden></p><footer><button class="primary" type="submit">应用</button><button type="button" data-cancel>取消</button></footer>`;
  const values = { ...state, ...original };
  for (const name of ["position", "diceUsed"]) body.elements[name].value = values[name] ?? "";
  body.elements.bonusRoll.checked = values.bonusRoll ?? state.bonusRoll;
  for (let slot = 0; slot < 5; slot++) {
    const label = document.createElement("label"), select = document.createElement("select");
    label.textContent = `${slot + 1}号`; select.name = "slot" + slot;
    select.add(new Option("无", "0"));
    for (const card of cards.slice(1)) if (cardClass(card.id) === card.id) select.add(new Option(cardLabels[card.id - 1], String(card.id)));
    select.value = String(original.hand?.[slot] ?? 0);
    label.append(select); body.querySelector(".assist-hand-inputs").append(label);
  }
  const node = dialog("修正读取值", body, { className: "mode-dialog" });
  body.querySelector("[data-cancel]").onclick = () => node.close();
  body.onsubmit = event => {
    event.preventDefault();
    const error = body.querySelector(".assist-form-error");
    const slots = Array.from({ length: 5 }, (_, i) => Number(body.elements["slot" + i].value));
    const gap = slots.indexOf(0);
    if (gap !== -1 && slots.slice(gap).some(Boolean)) { error.hidden = false; error.textContent = "持有卡牌请从左侧开始连续选择，不要留空。"; return; }
    if (assist.stream !== stream || !assist.tracker.lastObservation?.visible) {
      error.hidden = false; error.textContent = "请重新展示当前游戏画面后再应用。"; return;
    }
    const current = assist.tracker.lastObservation;
    const changed = ["position", "diceUsed", "bonusRoll", "hand"].some(key => JSON.stringify(current[key]) !== JSON.stringify(original[key]));
    if (changed) { error.hidden = false; error.textContent = "输入期间画面发生了变化。请关闭后按最新数值重新确认。"; return; }
    const correction = { position: Number(body.elements.position.value), diceUsed: Number(body.elements.diceUsed.value), bonusRoll: body.elements.bonusRoll.checked, hand: slots.filter(Boolean) };
    if (!Number.isInteger(correction.position) || !Number.isInteger(correction.diceUsed)) return;
    if (assist.correct(correction)) { node.close(); toast("将按输入的数值确认状态。"); }
  };
  body.elements[assist.reading.issue === "dice" ? "diceUsed" : "position"].focus({ preventScroll: true });
  body.elements[assist.reading.issue === "dice" ? "diceUsed" : "position"].select();
}

function monitor(assist, bar, watch) {
  const node = document.createElement("aside");
  node.id = "assist-monitor";
  node.className = "assist-monitor"; node.hidden = true;
  node.setAttribute("aria-label", "共享画面预览");
  node.innerHTML = `<header><span aria-hidden="true" class="assist-grip">⠿</span><strong>共享画面</strong><button type="button" data-fold aria-label="折叠预览">−</button><button type="button" data-hide aria-label="隐藏预览">×</button></header><div class="assist-monitor-screen"><video autoplay muted playsinline disablepictureinpicture></video><span hidden>无法显示预览</span></div>`;
  document.body.append(node);
  const video = node.querySelector("video"), screen = node.querySelector(".assist-monitor-screen"), header = node.querySelector("header");
  let hidden = false, collapsed = false, moved = false, position, drag, lastStream;
  function place() {
    if (node.hidden) return;
    const top = 8;
    const size = node.getBoundingClientRect();
    const maxX = Math.max(8, innerWidth - size.width - 12), maxY = Math.max(top, innerHeight - size.height - 12);
    if (!moved) position = { x: maxX, y: bar.getBoundingClientRect().bottom + 8 };
    position.x = Math.max(8, Math.min(maxX, position.x));
    position.y = Math.max(top, Math.min(maxY, position.y));
    node.style.transform = `translate(${position.x}px, ${position.y}px)`;
  }
  const update = () => {
    const stream = assist.stream;
    if (stream !== lastStream) {
      lastStream = stream; hidden = false;
      video.srcObject = stream;
      node.querySelector(".assist-monitor-screen > span").hidden = true;
      if (stream) video.play().catch(() => { if (video.srcObject === stream) node.querySelector(".assist-monitor-screen > span").hidden = false; });
      else video.pause();
    }
    node.hidden = hidden || !stream || assist.session.mode !== "assist";
    watch.hidden = !stream;
    watch.disabled = !stream;
    watch.setAttribute("aria-pressed", String(!node.hidden));
    watch.title = node.hidden ? "打开共享画面预览" : "隐藏共享画面预览";
    screen.hidden = collapsed;
    const region = assist.region, size = assist.sourceSize;
    video.style.cssText = region && size ? `width:${size.width / region.width * 100}%;height:${size.height / region.height * 100}%;left:${-region.x / region.width * 100}%;top:${-region.y / region.height * 100}%` : "";
    place();
  };
  node.querySelector("[data-hide]").onclick = () => { hidden = true; update(); };
  node.querySelector("[data-fold]").onclick = event => {
    collapsed = !collapsed;
    event.currentTarget.textContent = collapsed ? "+" : "−";
    event.currentTarget.setAttribute("aria-label", collapsed ? "展开预览" : "折叠预览");
    update();
  };
  header.onpointerdown = event => {
    if (event.button !== 0 || event.target.closest("button")) return;
    event.preventDefault(); header.setPointerCapture(event.pointerId);
    drag = { x: event.clientX - position.x, y: event.clientY - position.y };
    node.classList.add("is-dragging");
  };
  header.onpointermove = event => {
    if (!drag) return;
    moved = true;
    position = { x: event.clientX - drag.x, y: event.clientY - drag.y }; place();
  };
  const stopDrag = () => { drag = null; node.classList.remove("is-dragging"); };
  header.onpointerup = header.onpointercancel = header.onlostpointercapture = stopDrag;
  addEventListener("resize", place);
  return { toggle() { hidden = !node.hidden; update(); }, update };
}

export function bindAssistBar(session, assist, prediction, voice) {
  const bar = document.createElement("aside");
  bar.id = "assist-bar"; bar.className = "assist-bar"; bar.hidden = true;
  bar.setAttribute("aria-label", "辅助状态与提示");
  bar.innerHTML = `<div class="assist-bar-copy"><div class="assist-status-line"><span class="assist-badge">辅助<span class="assist-beta">BETA</span></span><span class="assist-status"></span><span class="assist-count" hidden></span></div>
    <strong class="assist-request" role="status" aria-live="polite"></strong><small class="assist-request-detail"></small><progress max="30" value="0" aria-label="已确认的卡牌记录" hidden></progress></div>
    <div class="assist-bar-actions"><button type="button" class="assist-correct" hidden>手动输入</button><button type="button" class="assist-watch" aria-controls="assist-monitor" aria-pressed="false">画面</button><button type="button" class="assist-voice" aria-label="语音引导设置">语音</button><button type="button" class="assist-open">连接管理</button></div>`;
  document.body.append(bar);
  const watch = bar.querySelector(".assist-watch"), preview = monitor(assist, bar, watch);
  let lastIssue, issueSince = 0;
  bar.querySelector(".assist-open").onclick = () => { prediction.hide(); showModes(session, assist, { screen: true, voice }); };
  watch.onclick = () => preview.toggle();
  const voiceButton = bar.querySelector(".assist-voice");
  voiceButton.hidden = !voice;
  voiceButton.onclick = () => { prediction.hide(); showVoiceSettings(voice); };
  const updateVoice = () => {
    voiceButton.dataset.enabled = String(voice.enabled && !voice.playbackBlocked);
    voiceButton.textContent = voice.playbackBlocked ? "确认语音" : voice.enabled ? "语音已开启" : "语音";
    voiceButton.title = voice.playbackBlocked ? "请在语音设置中确认播放" : voice.enabled ? "语音引导设置 · 已开启" : "语音引导设置";
  };
  voice?.addEventListener("change", updateVoice);
  if (voice) updateVoice();
  bar.querySelector(".assist-correct").onclick = () => { prediction.hide(); showCorrection(assist); };
  const update = () => {
    bar.hidden = session.mode !== "assist";
    document.body.classList.toggle("is-assisting", !bar.hidden);
    const r = assist.reading;
    if (r.issue !== lastIssue) { lastIssue = r.issue; issueSince = performance.now(); }
    bar.dataset.status = r.ready ? "ready" : assist.stream ? "checking" : "disconnected";
    bar.querySelector(".assist-status").textContent = assist.stream ? r.ready ? "共享中 · 已联动" : "共享中 · 确认中" : "已停止共享";
    const [title, detail] = guidance(assist, performance.now() - issueSince);
    const request = bar.querySelector(".assist-request");
    if (request.textContent !== title) request.textContent = title;
    const items = assist.tracker.lastObservation?.items;
    const charges = assist.tracker.lastObservation?.charges;
    const itemText = items
      ? `道具 ${items.count}/${items.slots.length}${items.slots.filter(v => v !== null).length ? `（${items.slots.filter(v => v !== null).map(v => v === "?" ? "?" : `#${v}`).join(" ")}）` : ""}`
      : null;
    const extras = r.ready
      ? [charges != null ? `可投掷 ${charges}` : null, itemText].filter(Boolean).join(" · ")
      : "";
    bar.querySelector(".assist-request-detail").textContent = extras ? `${detail} ${extras}。` : detail;
    const scanning = !!assist.stream && r.issue?.startsWith("deck-");
    const count = bar.querySelector(".assist-count");
    count.hidden = !scanning; count.textContent = `${r.seen || 0} / 30 已确认`;
    const progress = bar.querySelector("progress");
    progress.hidden = !scanning; progress.value = r.seen || 0;
    const correct = bar.querySelector(".assist-correct");
    correct.hidden = !assist.stream || !r.canCorrect || (!r.ready && !(fields[r.issue] && performance.now() - issueSince > 2500));
    correct.textContent = r.ready ? "修正数值" : "手动输入";
    preview.update();
  };
  session.addEventListener("change", update); assist.addEventListener("change", update);
  update();
}
