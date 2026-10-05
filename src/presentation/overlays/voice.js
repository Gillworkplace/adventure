import { dialog, confirmAction } from "./dialogs.js";
import { showModelSelection } from "./models.js";
import { LANGUAGES, loadVoiceCatalog } from "../../speech/manifest.js";
import { isPackCached } from "../../speech/storage.js";
import { bindVolumeSlider } from "../input/volume.js";

import { CUE_OPTIONS } from "../../speech/cues.js";

const megabytes = bytes => (bytes / 1e6).toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + " MB";
function showVoiceInfo() {
  const body = document.createElement("div"); body.className = "voice-license";
  body.innerHTML = `<p>此引导语音是使用 Google Gemini 3.8 Flash TTS (gemini-3.8-flash-tts) 模型预先生成的 AI 语音。</p>
    <p>已应用面向句级高质量语音合成与自然停顿的无声优化处理。</p>`;
  dialog("语音信息", body, { className: "voice-license-dialog" });
}

export function showVoiceSettings(voice) {
  if (document.querySelector("dialog")) return;
  const release = voice.hold(), body = document.createElement("div"); body.className = "voice-settings";
  body.innerHTML = `<div class="voice-intro"><p>用语音播报画面确认请求和推荐行动。</p><span class="voice-state"></span></div>
    <div class="voice-model-needed" hidden><span>请先选择用于推荐行动的模型。</span><button type="button" data-model>模型选择</button></div>
    <fieldset class="voice-controls"><div class="voice-selects"><label>语言<select name="language" aria-label="引导语言"></select></label><label>声音<select name="voice" aria-label="语音声音"></select></label></div>
      <label class="voice-slider"><span>音量 <output data-volume></output></span><input name="volume" aria-label="音量" type="range" min="0" max="100" step="1"></label>
      <details class="voice-advanced">
        <summary>引导项目选择 (高级)</summary>
        <div class="voice-cues-list">
          ${CUE_OPTIONS.map(([key, label, hint]) => `<label class="voice-check"><input type="checkbox" name="cue_${key}"><span>${label}<small>${hint}</small></span></label>`).join("")}
        </div>
      </details>
    </fieldset>
    <section class="voice-data"><div class="voice-data-heading"><strong data-pack-title>语音数据</strong><span data-pack-size></span></div>
      <p data-pack-note>正在确认语音列表。</p>
      <label class="voice-check" data-persist-row><input type="checkbox" name="persist"><span>保存到此浏览器<small>下次也将使用已保存的语音。</small></span></label>
      <small class="voice-storage-note" hidden></small><div class="voice-cache-total" hidden><span></span><button type="button" data-clear>删除已保存语音</button></div>
    </section>
    <div class="voice-consent"><p>由 Gemini 3.8 Flash TTS 预先生成的 AI 语音。</p><button type="button" data-license>语音信息</button></div>
    <div class="voice-progress" role="status" hidden><div><span data-stage></span><output data-percent></output></div><progress max="100" value="0" aria-label="语音下载进度"></progress><small data-detail></small></div>
    <p class="voice-error" role="alert" hidden></p>
    <footer><button type="button" class="primary" data-apply>下载并开启</button><button type="button" data-preview>试听</button><button type="button" data-off hidden>关闭语音</button><button type="button" data-stop hidden>取消</button><button type="button" data-retry hidden>重新确认</button></footer>`;
  const el = selector => body.querySelector(selector), input = name => el(`[name="${name}"]`);
  const CUE_KEYS = CUE_OPTIONS.map(([key]) => key);
  for (const lang of LANGUAGES) input("language").add(new Option(lang.name, lang.id));
  for (const [id, name] of [["F", "女声"], ["M", "男声"]]) input("voice").add(new Option(name, id));
  input("language").value = voice.settings.language; input("voice").value = voice.settings.voice;
  input("volume").value = Math.round(voice.settings.volume * 100); input("persist").checked = voice.settings.persist;
  for (const key of CUE_KEYS) input("cue_" + key).checked = voice.settings.cues?.[key] !== false;
  let catalog = [], catalogError = null, reading = true, deleting = false, closed = false;
  const selection = () => catalog.find(pack => pack.language === input("language").value && pack.voice === input("voice").value);
  const isCurrent = pack => voice.enabled && pack && voice.pack?.descriptor.sha256 === pack.sha256;
  function update() {
    const pack = selection(), current = isCurrent(pack), saved = isPackCached(voice.cache, pack), busy = voice.preparing;
    el(".voice-state").textContent = busy ? "准备中" : voice.playbackBlocked ? "确认播放" : voice.enabled ? "已开启" : "已关闭"; el(".voice-state").dataset.ready = String(voice.enabled && !voice.playbackBlocked);
    el(".voice-model-needed").hidden = voice.available; el(".voice-controls").disabled = busy || !voice.available;
    el("[data-volume]").textContent = Math.round(voice.settings.volume * 100) + "%";
    el("[data-pack-title]").textContent = current ? "使用中的语音" : saved ? "已保存的语音" : "待下载的语音";
    el("[data-pack-size]").textContent = pack ? megabytes(pack.bytes) : "";
    el("[data-pack-note]").textContent = reading ? "正在确认语音列表。" : !pack ? "所选语音尚未就绪。" : current || saved ? "所选语音可直接使用。" : "将下载所选语音。";
    const space = !pack || voice.cache.freeBytes === null || voice.cache.freeBytes >= pack.bytes * 1.1;
    el("[data-persist-row]").hidden = current || saved;
    input("persist").disabled = busy || !voice.available || !voice.cache.available || !space;
    if (!voice.cache.available || !space) input("persist").checked = false;
    el(".voice-storage-note").hidden = current || saved || voice.cache.available && space;
    el(".voice-storage-note").textContent = !space ? "存储空间不足。可以不保存直接使用。" : "此浏览器无法保存。只能本次访问期间使用。";
    el(".voice-cache-total").hidden = !voice.cache.bytes;
    el(".voice-cache-total > span").textContent = "浏览器中共保存 " + megabytes(voice.cache.bytes);
    el("[data-clear]").disabled = busy || deleting; el("[data-clear]").textContent = deleting ? "删除中…" : "删除已保存语音";
    el(".voice-progress").hidden = !busy;
    if (busy) {
      const progress = voice.progress || {}, percent = Math.min(100, Math.round((progress.loaded || 0) / (progress.total || 1) * 100));
      el("[data-stage]").textContent = progress.phase === "verify" ? "正在确认语音" : "正在加载语音";
      el("[data-percent]").textContent = percent + "%"; el("progress").value = percent;
      el("[data-detail]").textContent = `${megabytes(progress.loaded || 0)} / ${megabytes(progress.total || 0)}`;
    }
    el(".voice-error").hidden = !(voice.error || catalogError); el(".voice-error").textContent = voice.error || catalogError || "";
    el("[data-apply]").hidden = current && !busy;
    el("[data-apply]").disabled = busy || reading || deleting || !voice.available || !pack;
    el("[data-apply]").textContent = busy ? "准备中…" : saved ? voice.enabled ? "应用语音" : "开启语音" : voice.enabled ? "下载并应用" : "下载并开启";
    el("[data-preview]").disabled = !current || busy || !voice.available;
    el("[data-preview]").textContent = voice.previewing ? "停止播放" : "试听";
    for (const key of CUE_KEYS) {
      input("cue_" + key).checked = voice.settings.cues?.[key] !== false;
      input("cue_" + key).disabled = busy || !voice.available;
    }
    el("[data-off]").hidden = !voice.enabled || busy; el("[data-stop]").hidden = !busy;
    el("[data-retry]").hidden = !catalogError; el("[data-retry]").disabled = reading;
  }
  async function refresh() {
    reading = true; catalogError = null; update();
    try { catalog = await loadVoiceCatalog(); await voice.inspect(); }
    catch (error) { catalogError = error.message; }
    finally { if (!closed) { reading = false; update(); } }
  }
  for (const name of ["language", "voice"]) input(name).onchange = () => { voice.stopPreview(); update(); };
  input("volume").oninput = () => voice.change({ volume: Number(input("volume").value) / 100 });
  bindVolumeSlider(input("volume"));
  for (const key of CUE_KEYS) {
    input("cue_" + key).onchange = () => {
      voice.change({ cues: { [key]: input("cue_" + key).checked } });
    };
  }
  el("[data-apply]").onclick = () => {
    const pack = selection(); if (!pack) return;
    voice.apply(pack, { persist: !input("persist").disabled && input("persist").checked, download: !isPackCached(voice.cache, pack) });
  };
  el("[data-preview]").onclick = () => voice.previewing ? voice.stopPreview() : voice.preview();
  el("[data-off]").onclick = () => voice.disable();
  el("[data-stop]").onclick = () => voice.cancelPreparation();
  el("[data-license]").onclick = showVoiceInfo; el("[data-retry]").onclick = refresh;
  el("[data-clear]").onclick = async () => {
    if (!await confirmAction("删除已保存的语音", "下次访问时会重新下载所需的语音。正在使用的语音仍可继续收听。", { confirmLabel: "删除" })) return;
    deleting = true; update(); await voice.clearCache(); deleting = false; input("persist").checked = false; if (!closed) update();
  };
  update();
  const node = dialog("语音引导", body, { className: "voice-dialog" });
  el("[data-model]").onclick = () => {
    node.addEventListener("close", () => showModelSelection(voice.coordinator), { once: true });
    node.close();
  };
  voice.addEventListener("change", update);
  node.addEventListener("close", () => {
    closed = true; voice.removeEventListener("change", update);
    if (voice.preparing) voice.cancelPreparation();
    release();
  }, { once: true });
  refresh(); return node;
}
