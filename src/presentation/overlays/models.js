import { dialog, confirmAction, paintChoices, toast } from "./dialogs.js";
import { showSettings } from "./settings.js";
import { modelComparison } from "../../content/models.js";
import { sameModel, LOCAL_MODEL as localModel } from "../../compute/vela/model.js";
import { compatibilityMessage } from "../../content/compatibility.js";
import { showSupport } from "../components/support.js";
import { diagnostics } from "../../platform/report.js";
import { showDiagnostics } from "./diagnostics.js";
import { downloadProgress } from "./download-progress.js";

const megabytes = bytes => `${Math.round(bytes / 1e6).toLocaleString()} MB`;
const transferLabel = localModel ? "读取文件" : "下载";
const memoryText = manifest => manifest.recommendedMemoryBytes
  ? `建议预留约 ${megabytes(manifest.recommendedMemoryBytes)} 以上内存 · 因设备而异`
  : "内存占用因设备与游戏状态而异。";
const comparison = model => {
  const { meanScore, relativeTime } = modelComparison[model];
  return `<span class="model-choice-metrics"><span>平均成绩 <b>约 ${Math.round(meanScore).toLocaleString("ko-KR")}分</b></span><span>推理时间 <b>${relativeTime}</b></span></span>`;
};
export function showModelSelection(coordinator, { initial = false, selectedModel, onFinish } = {}) {
  if (document.querySelector("dialog")) return;
  const resume = coordinator.suspend();
  const body = document.createElement("div");
  const node = dialog("模型选择", body, { className: "model-dialog" });
  const urlModel = new URLSearchParams(location.search).get("model");
  let controller, epoch = 0, handedOff = false, deletingCache = false,
    selected = selectedModel ?? (coordinator.enabled ? coordinator.settings.model : urlModel === "x36" ? "x36" : "vela");
  const heading = node.querySelector("h2");
  const focusPrimary = () => body.querySelector(".primary:not(:disabled)")?.focus({ preventScroll: true });
  const leave = next => { handedOff = true; node.addEventListener("close", next, { once: true }); node.close(); };
  node.addEventListener("close", () => {
    resume();
    epoch++; controller?.abort(); coordinator.removeEventListener("capabilities", refreshSupport);
    if (handedOff) return;
    coordinator.cancelModelPreparation();
    if (initial && !coordinator.enabled) confirmSkip();
    else {
      if (coordinator.enabled) coordinator.recalculate();
      onFinish?.();
    }
  }, { once: true });
  const navigation = () => '<footer><button type="button" class="model-back">上一步</button><span></span><button type="button" class="primary">下一步</button></footer>';
  function refreshSupport() {
    const input = body.querySelector('[name=model][value=vela]');
    if (!input) return;
    const support = coordinator.velaSupport, hint = body.querySelector(".vela-availability"), detail = body.querySelector(".vela-support");
    input.disabled = support.state !== "available";
    if (support.state === "checking" || support.state === "unchecked") { hint.textContent = "正在检查可用性"; detail.replaceChildren(); }
    else if (!support.available) {
      hint.textContent = compatibilityMessage(support.code).title;
      showSupport(detail, support.code, { retry: () => coordinator.checkVela(true), target: "VELA 可用性", label: "原因·解决方法" });
      if (selected === "vela") { selected = "x36"; body.querySelector('[name=model][value=x36]').checked = true; }
    } else { hint.textContent = localModel ? "读取本电脑的模型 · 约 68 MB" : "首次使用需下载完整模型 · 约 68 MB"; detail.replaceChildren(); }
    body.querySelector(".primary").disabled = deletingCache || selected === "vela" && input.disabled;
    input.closest(".model-option").classList.toggle("has-support", !!detail.firstElementChild);
    paintChoices(body);
    if (document.activeElement === node.querySelector(".dialog-close")) focusPrimary();
  }
  coordinator.addEventListener("capabilities", refreshSupport);
  async function confirmSkip() {
    const skip = await confirmAction("不使用推荐直接开始吗？", "将不使用行动推荐进行游戏。稍后可在“模型选择”中开启推荐。",
      { confirmLabel: "不使用推荐开始", cancelLabel: "模型选择", className: "model-dialog model-skip-dialog" });
    if (skip) {
      await coordinator.dispose();
      document.querySelector("#settings-button").focus({ preventScroll: true });
      onFinish?.({ skipped: true });
    }
    else showModelSelection(coordinator, { initial, selectedModel: selected, onFinish });
  }
  function select() {
    epoch++; controller?.abort(); controller = null; coordinator.cancelModelPreparation();
    heading.textContent = "模型选择";
    body.innerHTML = `<p class="model-intro">请选择帮助你在游戏中决定下一步行动的模型。</p>
      <div class="model-options" role="radiogroup" aria-label="模型">
        <div class="model-option"><label class="model-choice"><input type="radio" name="model" value="vela"><span class="model-choice-copy"><strong>VELA <small>v4.2</small></strong><span>CPU 即时判断</span>${comparison("vela")}<small class="vela-availability">正在检查可用性</small></span><span class="model-check" aria-hidden="true"></span></label><div class="model-support vela-support"></div></div>
        <label class="model-choice"><input type="radio" name="model" value="x36"><span class="model-choice-copy"><strong>X36 <small>G3</small></strong><span>通过模拟比较各选择</span>${comparison("x36")}<small>GPU 或 CPU · 可选择占用程度</small></span><span class="model-check" aria-hidden="true"></span></label>
      </div>
      <p class="model-comparison-note">仅供参考 · 各模型评估样本不同 · 因设备与状态而异</p>
      <div class="model-cache-tools" ${!localModel && coordinator.velaCacheAllowed ? "" : "hidden"}><span>${localModel ? "已存在之前保存的模型。" : "已允许在此浏览器中保存模型。"}</span><button type="button" class="model-forget">${localModel ? "删除已保存的模型" : "取消保存并删除"}</button></div>
      <footer><a class="legacy-access" aria-label="前往旧版界面"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M3 7h14"/></svg><span>旧版界面</span><span class="legacy-arrow" aria-hidden="true">→</span></a><span></span><button type="button" class="primary">下一步</button><button type="button" class="model-cancel">取消</button></footer>`;
    body.querySelector(".legacy-access").href = new URL("../../../old/v1/", import.meta.url).href + location.search + location.hash;
    body.querySelector(`[value="${selected}"]`).checked = true;
    body.querySelectorAll("[name=model]").forEach(input => input.onchange = () => { selected = input.value; refreshSupport(); });
    body.querySelector(".model-cancel").onclick = () => node.close();
    body.querySelector(".model-forget").onclick = async event => {
      const button = event.currentTarget; button.disabled = true; deletingCache = true; refreshSupport();
      try {
        await coordinator.clearVelaCache();
        const tools = body.querySelector(".model-cache-tools");
        if (node.open && tools) { tools.querySelector("span").textContent = "已删除保存的模型。"; button.hidden = true; }
      }
      catch { if (node.open) { button.textContent = "重新删除"; button.disabled = false; toast("无法删除模型文件。请关闭其他 Adventure 标签页后重试。"); } }
      finally { deletingCache = false; if (node.open) refreshSupport(); }
    };
    body.querySelector(".primary").onclick = () => selected === "vela" ? inspectVela() : loadX36();
    if (localModel) {
      const current = epoch, tools = body.querySelector(".model-cache-tools");
      coordinator.hasVelaCache().then(exists => {
        if (node.open && current === epoch && !deletingCache) tools.hidden = !exists;
      }).catch(() => {});
    }
    coordinator.checkVela(); refreshSupport(); focusPrimary();
  }
  async function inspectVela() {
    const current = progressScreen("VELA 准备"), signal = controller.signal;
    body.querySelectorAll(".model-meter, progress").forEach(element => element.hidden = true);
    body.querySelector(".model-loading-title").textContent = "正在确认要使用的模型。";
    try {
      const { latest } = await coordinator.inspectVela(signal);
      if (signal.aborted || current !== epoch || !node.open) return;
      if (localModel) localPreparation(latest);
      else if (coordinator.velaCacheAllowed) loadVela(true, latest);
      else consent(latest);
    } catch (error) {
      if (!signal.aborted && current === epoch && node.open) {
        failure(error, inspectVela);
      }
    }
  }
  function localPreparation(manifest) {
    heading.textContent = "VELA 准备";
    body.innerHTML = `<p class="model-intro">正在读取本电脑的模型文件。</p>
      <div class="model-size"><strong>${megabytes(manifest.bytes)} <span>模型文件</span></strong></div>
      <p class="model-memory">${memoryText(manifest)}</p>${navigation()}`;
    body.querySelector(".model-back").onclick = select;
    const primary = body.querySelector(".primary"); primary.textContent = "读取模型";
    primary.onclick = () => loadVela(false, manifest);
    focusPrimary();
  }
  function consent(manifest, issue) {
    heading.textContent = "VELA 准备";
    const resident = coordinator.vela?.ready && sameModel(coordinator.vela.info.manifest, manifest);
    const supported = coordinator.velaSupport.storage !== false && !!navigator.storage?.getDirectory && !issue;
    body.innerHTML = `<p class="model-intro">${resident ? "模型已就绪。请选择是否保存以便下次访问。" : localModel ? "将读取本电脑的模型文件并完成准备。" : "将一次性下载完整模型并完成准备。"}</p>
      <div class="model-size"><strong>${megabytes(manifest.bytes)} <span>${resident || localModel ? "模型文件" : "下载"}</span></strong>${resident ? `<span>${localModel ? "保存后将重新读取文件" : "保存后将重新下载"}</span>` : ""}</div>
      <p class="model-memory">${memoryText(manifest)}</p>
      <p class="model-question">${localModel ? "是否也将模型保存到浏览器？" : "下次也要免下载直接使用吗？"}</p>
      <div class="cache-options" role="radiogroup" aria-label="模型保存确认">
        <label><input type="radio" name="cache" value="yes" ${supported ? "" : "disabled"}><span><strong>保存到此浏览器</strong><small>将检查存储空间和可用性。</small></span></label>
        <label><input type="radio" name="cache" value="no" checked><span><strong>仅本次使用</strong><small>${localModel ? "下次访问时将重新读取本电脑的文件。" : "下次访问时将重新下载。"}</small></span></label>
      </div><div class="model-support cache-support"></div>
      <p class="model-note">${localModel ? "将额外占用浏览器存储空间。" : "清理浏览器数据或存储空间不足时，可能需要重新下载。"}</p>${navigation()}`;
    if (!supported) showSupport(body.querySelector(".cache-support"), issue || "storage-unsupported", { retry: issue ? () => consent(manifest) : null, target: "模型保存", retryLabel: "更改设置" });
    body.querySelector(".model-back").onclick = select;
    const primary = body.querySelector(".primary"); primary.textContent = "读取模型";
    primary.onclick = async () => {
      const persist = body.querySelector("[name=cache]:checked").value === "yes";
      if (persist) {
        controller?.abort(); controller = new AbortController();
        const current = ++epoch, signal = controller.signal;
        primary.disabled = true; primary.textContent = "正在确认保存";
        try {
          const result = await coordinator.checkVelaStorage(manifest, signal);
          if (signal.aborted || current !== epoch || !node.open) return;
          if (!result.available) { consent(manifest, result.code); return; }
        } catch (error) { if (!signal.aborted && current === epoch && node.open) consent(manifest, "storage-failed"); return; }
      }
      if (!coordinator.setVelaCacheAllowed(persist) && persist) { consent(manifest, "storage-denied"); return; }
      if (persist) navigator.storage.persist?.().catch(() => {});
      loadVela(persist, manifest);
    };
    paintChoices(body); focusPrimary();
  }
  function progressScreen(title, manifest) {
    heading.textContent = title;
    body.innerHTML = `<div class="model-loading" aria-live="polite"><p class="model-loading-title">正在准备。</p><p class="model-loading-detail">请稍候。</p>
      <div class="model-meter"><span>${transferLabel}</span><strong class="model-transfer">准备中</strong></div><progress class="model-download" max="1" value="0" aria-label="模型 ${transferLabel}"></progress>
      <p class="model-transfer-detail" aria-live="off" hidden></p>
      <div class="model-meter"><span>模型准备</span><strong class="model-prepared">等待中</strong></div><progress class="model-prepare" max="1" value="0" aria-label="模型准备"></progress>
      </div>${manifest ? `<p class="model-memory">${memoryText(manifest)}</p>` : ""}<footer><button class="model-back">上一步</button><span></span><button class="model-cancel">取消</button></footer>`;
    body.querySelector(".model-back").onclick = select; body.querySelector(".model-cancel").onclick = () => node.close();
    controller?.abort(); controller = new AbortController(); return ++epoch;
  }
  async function loadVela(persist, manifest, cachedOnly = false) {
    const current = progressScreen("VELA 准备", manifest), signal = controller.signal;
    const transfer = localModel ? null : downloadProgress(body.querySelector(".model-transfer-detail"));
    signal.addEventListener("abort", () => transfer?.dispose(), { once: true });
    let downloaded = false;
    try {
      const info = await coordinator.prepareVela({ persist, manifest, cachedOnly, signal, onProgress: data => {
        if (current !== epoch || !node.open) return;
        transfer?.update(data);
        const cached = data.phase === "cache";
        body.querySelector(".model-loading-title").textContent = cached ? "正在将模型载入内存" : data.phase === "download" ? localModel ? "正在读取 VELA" : "正在下载 VELA" : data.phase === "retry" ? localModel ? "正在重新读取模型文件" : "正在重新下载模型" : "正在准备 VELA";
        body.querySelector(".model-loading-detail").textContent = data.phase === "retry" ? localModel ? "将读取本电脑的模型文件，而不是浏览器保存的版本。" : "未找到已保存的文件，正在重新下载。" : "准备完成后即可使用。";
        if (data.phase === "download" || (!downloaded && cached)) {
          body.querySelector(".model-meter span").textContent = cached ? "已保存的文件" : transferLabel;
          body.querySelector(".model-download").setAttribute("aria-label", cached ? "读取已保存的模型" : `模型 ${transferLabel}`);
          body.querySelector(".model-transfer").textContent = data.total ? `${megabytes(data.received)} / ${megabytes(data.total)}` : "准备中";
          body.querySelector(".model-download").value = data.fraction || 0;
          if (data.phase === "download") downloaded = true;
        }
        if (downloaded && data.phase === "prepare") {
          body.querySelector(".model-transfer").textContent = `${megabytes(manifest.bytes)} / ${megabytes(manifest.bytes)}`;
          body.querySelector(".model-download").value = 1;
        }
        body.querySelector(".model-prepare").value = data.prepared || 0;
        body.querySelector(".model-prepared").textContent = data.prepared ? `${Math.round(data.prepared * 100)}%` : "等待中";
      }});
      if (signal.aborted || current !== epoch || !node.open) return;
      heading.textContent = `${info.manifest.name} 准备完成`;
      body.innerHTML = `<div class="model-ready"><span class="model-ready-mark" aria-hidden="true">✓</span><strong>现在可以比较下一步行动了。</strong><p>${info.cacheSaved ? "下次将继续使用保存在此浏览器中的模型。" : "本次访问期间可以使用模型。"}</p></div>${info.cacheFailed ? `<p class="model-cache-warning">无法保存模型。${localModel ? "下次访问时将重新读取本电脑的文件。" : "下次访问时需要重新下载。"}</p><div class="model-support cache-support"></div>` : ""}<footer><button class="model-back">上一步</button><span></span><button class="primary">${initial ? "开始" : "应用"}</button></footer>`;
      if (info.cacheFailed) { showSupport(body.querySelector(".cache-support"), info.cacheIssue || "storage-failed", { target: "模型保存" }); toast("无法保存模型，本次仍可使用。"); }
      body.querySelector(".model-back").onclick = select;
      body.querySelector(".primary").onclick = () => leave(() => {
        coordinator.configure({ model: "vela" });
        onFinish?.();
      });
      focusPrimary();
    } catch (error) { if (!signal.aborted && current === epoch && node.open) failure(error, inspectVela); }
    finally { transfer?.dispose(); }
  }
  async function loadX36() {
    const current = progressScreen("X36 准备"), signal = controller.signal;
    body.querySelectorAll(".model-meter,.model-download").forEach(el => el.hidden = true);
    body.querySelector(".model-prepare").removeAttribute("value");
    body.querySelector(".model-loading-detail").textContent = "正在准备计算引擎。";
    try {
      await coordinator.prepare({ signal }); coordinator.checkGpu();
      if (signal.aborted || current !== epoch || !node.open) return;
      leave(() => showSettings(coordinator, { initial, onBack: () => showModelSelection(coordinator, { initial, selectedModel: selected, onFinish }), onCancel: initial && !coordinator.enabled ? confirmSkip : undefined, onFinish }));
    } catch (error) { if (!signal.aborted && current === epoch && node.open) failure(error, loadX36); }
  }
  function failure(error, retry) {
    diagnostics.capture(error, "model.prepare");
    console.error("Model preparation failed", error);
    heading.textContent = "模型准备失败";
    body.innerHTML = '<p class="model-intro">可以重试，或选择其他模型。</p><div class="model-support failure-support"></div><footer><button class="model-back">模型选择</button><button class="diagnostics-button">诊断信息</button><span></span><button class="primary">重试</button></footer>';
    body.querySelector(".diagnostics-button").onclick = showDiagnostics;
    showSupport(body.querySelector(".failure-support"), error.code || "network", { target: "模型准备" });
    body.querySelector(".model-back").onclick = select; body.querySelector(".primary").onclick = retry; focusPrimary();
  }
  select(); return node;
}
