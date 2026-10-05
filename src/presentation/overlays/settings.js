import { dialog, paintChoices } from "./dialogs.js";
import { compatibilityMessage } from "../../content/compatibility.js";
import { showSupport } from "../components/support.js";
const usageOptions = [
  ["low", "低", "优先其他任务"],
  ["medium", "中", "平衡"],
  ["high", "高", "优先快速计算"],
];
export function showSettings(coordinator, { initial = false, onBack, onCancel, onFinish } = {}) {
  if (document.querySelector("dialog")) return;
  const resume = coordinator.suspend();
  const settings = coordinator.settings,
    defaultWorkers = Math.ceil(coordinator.maxWorkers / 2),
    workers = [
      ...new Set([
        1,
        defaultWorkers,
        coordinator.maxWorkers,
        settings.workers || defaultWorkers,
      ]),
    ].sort((a, b) => a - b);
  const choice = (name, value, title, detail, defaultChoice = false) =>
    `<label class="model-choice compute-choice"><input type="radio" name="${name}" value="${value}"><span class="model-choice-copy"><strong>${title}${defaultChoice ? "<small>默认</small>" : ""}</strong><span class="compute-description">${detail}</span></span><span class="model-check" aria-hidden="true"></span></label>`;
  const body = document.createElement("form");
  body.method = "dialog";
  body.innerHTML = `<p class="model-intro">请选择计算方式与设备占用。</p>
  <fieldset class="compute-engine-options" aria-label="计算引擎">${choice("engine", "gpu", "GPU", "G3 · 更多样本")}${choice("engine", "cpu", "CPU", "G3 · 更少运算量")}</fieldset>
  <div class="model-support gpu-support"></div>
  <fieldset data-engine-panel="gpu"><legend>GPU 占用</legend><div class="compute-options">${usageOptions.map(([key, title, detail]) => choice("usage", key, title, detail, key === "medium")).join("")}</div></fieldset>
  <fieldset data-engine-panel="cpu"><legend>CPU 占用</legend><div class="compute-options">${workers.map((n) => choice("workers", n, n === 1 ? "低" : n === coordinator.maxWorkers ? "高" : "中", `${n}路并行计算`, n === defaultWorkers)).join("")}</div></fieldset>
  <footer><span></span><button type="submit" class="primary">${initial ? "开始" : "应用"}</button><button type="button" class="compute-cancel">取消</button></footer>`;
  for (const [key, value] of Object.entries({
    engine: settings.engine,
    usage: settings.usage,
    workers: settings.workers || defaultWorkers,
  }))
    body.elements[key].value = String(value);
  const gpuRadio = body.querySelector("[name=engine][value=gpu]");
  let engineChanged = false;
  const refresh = () => {
    const engine = body.elements.engine.value;
    body.querySelectorAll("[data-engine-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.enginePanel !== engine;
      panel
        .querySelectorAll("input")
        .forEach((input) => (input.disabled = panel.hidden));
    });
    paintChoices(body);
  };
  const refreshSupport = () => {
    const support = coordinator.gpuSupport, detail = body.querySelector(".gpu-support");
    const pending = support.state === "checking" || support.state === "unchecked";
    gpuRadio.disabled = support.state !== "available";
    const hint = gpuRadio.closest("label").querySelector(".compute-description");
    hint.textContent = pending ? "正在检查可用性" : support.available ? "G3 · 更多样本" : compatibilityMessage(support.code).title;
    if (gpuRadio.disabled) body.elements.engine.value = "cpu";
    else if (!engineChanged && settings.engine === "gpu") body.elements.engine.value = "gpu";
    if (!pending && !support.available && detail.dataset.code !== support.code) {
      detail.dataset.code = support.code;
      showSupport(detail, support.code, { retry: () => coordinator.checkGpu(true), target: "GPU 可用性", label: "GPU 不可用 · 帮助" });
    } else if (pending || support.available) { detail.replaceChildren(); delete detail.dataset.code; }
    refresh();
  };
  body.addEventListener("change", event => { if (event.target.name === "engine") engineChanged = true; refresh(); });
  coordinator.addEventListener("capabilities", refreshSupport);
  coordinator.checkGpu(); refreshSupport();
  if (onBack) {
    const back = document.createElement("button");
    back.type = "button"; back.className = "model-back"; back.textContent = "模型选择";
    body.querySelector("footer").prepend(back);
    back.onclick = () => { returning = true; node.addEventListener("close", onBack, { once: true }); node.close(); };
  }
  const node = dialog("X36 引擎选择", body, { className: "model-dialog compute-dialog" });
  let applied = false, returning = false;
  body.querySelector(".compute-cancel").onclick = () => node.close();
  node.addEventListener("close", () => {
    resume();
    coordinator.removeEventListener("capabilities", refreshSupport);
    if (applied || returning) return;
    if (onCancel) onCancel();
    else {
      if (coordinator.enabled) coordinator.recalculate();
      onFinish?.();
    }
  }, { once: true });
  body.onsubmit = (e) => {
    e.preventDefault();
    applied = true;
    const next = {
      model: "x36",
      engine: body.elements.engine.value === "gpu" && coordinator.gpuSupport.available ? "gpu" : "cpu",
      usage: body.elements.usage.value,
      workers: Number(body.elements.workers.value),
    };
    resume(); node.close();
    coordinator.configure(next);
    onFinish?.();
  };
  return node;
}
