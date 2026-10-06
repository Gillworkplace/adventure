import { GameRecognizer, CnGameRecognizer, findGameRegion } from "./vision.js";
import { RecognitionStatus } from "./status.js";
import { CharacterProbe } from "./character.js";

let recognizers = [], active = -1, region, sourceSize, lastSearch = -Infinity;
let searchIssue = "window";
const status = new RecognitionStatus();
const source = new OffscreenCanvas(1, 1), screen = new OffscreenCanvas(1234, 694);
const input = source.getContext("2d", { willReadFrequently: true });
const output = screen.getContext("2d", { willReadFrequently: true });
let anchorCanvas = new OffscreenCanvas(103, 14), anchorOutput = anchorCanvas.getContext("2d", { willReadFrequently: true });

function crop(rect) {
  output.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, 1234, 694);
  return screen.getContext("2d").getImageData(0, 0, 1234, 694);
}
function align(rect, recognizer) {
  const a = recognizer.anchor;
  if (anchorCanvas.width !== a.width || anchorCanvas.height !== a.height) {
    anchorCanvas = new OffscreenCanvas(a.width, a.height);
    anchorOutput = anchorCanvas.getContext("2d", { willReadFrequently: true });
  }
  let best = null, score = 0;
  const probe = (dy, dx) => {
    const x = rect.x + dx * rect.scale, y = rect.y + dy * rect.scale;
    anchorOutput.drawImage(source, x + a.x * rect.scale, y + a.y * rect.scale, a.width * rect.scale, a.height * rect.scale, 0, 0, a.width, a.height);
    const match = recognizer.anchorScore(anchorOutput.getImageData(0, 0, a.width, a.height));
    if (match > score) { score = match; best = { ...rect, x, y }; }
  };
  // 韩服窗口几何稳定，±1 像素微调即可；国服各截图的面板
  // 内容存在数像素的整体漂移，需要先粗搜再精调。
  if (recognizer.alignRange) {
    const step = 2, n = recognizer.alignRange;
    for (let dy = -n; dy <= n; dy += step) for (let dx = -n; dx <= n; dx += step) probe(dy, dx);
    const base = best ? { dy: (best.y - rect.y) / rect.scale, dx: (best.x - rect.x) / rect.scale } : { dy: 0, dx: 0 };
    for (let dy = base.dy - 1; dy <= base.dy + 1; dy += .5) for (let dx = base.dx - 1; dx <= base.dx + 1; dx += .5) probe(dy, dx);
  } else {
    for (const dy of [0, -.5, .5, -1, 1]) for (const dx of [0, -.5, .5, -1, 1]) probe(dy, dx);
  }
  return score > .62 ? best : null;
}

self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      // 可选探测不得拖延屏幕识别，也不得在其小型模板文件
      // 无法获取时导致启动失败。
      const optional = new AbortController(), timeout = setTimeout(() => optional.abort(), 2500);
      const characters = fetch(new URL("../../public/recognition/characters.json", import.meta.url), { signal: optional.signal })
        .then(response => response.ok ? response.json() : null)
        .then(value => value?.characters)
        .catch(() => null)
        .finally(() => clearTimeout(timeout));
      // 韩服与国服模板都加载；单个文件缺失时另一个仍可工作。
      const templates = await Promise.all([
        fetch(new URL("../../public/recognition/game.json", import.meta.url)).then(response => response.ok ? response.json() : null).catch(() => null),
        fetch(new URL("../../public/recognition/game-cn.json", import.meta.url)).then(response => response.ok ? response.json() : null).catch(() => null),
      ]);
      recognizers = [];
      if (templates[0]) recognizers.push(new GameRecognizer(templates[0]));
      if (templates[1]?.layout === "cn") recognizers.push(new CnGameRecognizer(templates[1]));
      if (!recognizers.length) throw Error("Recognition templates unavailable");
      self.postMessage({ type: "ready" });
      characters.then(value => { if (Array.isArray(value)) for (const recognizer of recognizers) if (recognizer instanceof GameRecognizer) recognizer.character = new CharacterProbe(value); });
    } catch (error) { self.postMessage({ type: "error", issue: "reader", error: { message: String(error?.message || error), stack: String(error?.stack || "") } }); }
    return;
  }
  const { bitmap, id, context } = data;
  if (!bitmap) return;
  const started = performance.now();
  try {
    if (!recognizers.length) throw Error("Reader unavailable");
    const size = bitmap.width + "x" + bitmap.height;
    if (size !== sourceSize) { region = null; active = -1; lastSearch = -Infinity; searchIssue = "window"; status.reset(); sourceSize = size; source.width = bitmap.width; source.height = bitmap.height; }
    input.drawImage(bitmap, 0, 0);
    let observation = region && recognizers[active] ? recognizers[active].read(crop(region), context) : null;
    if (!observation?.visible && started - lastSearch > 1200) {
      lastSearch = started;
      searchIssue = region ? "covered" : "window";
      for (const candidate of findGameRegion(input.getImageData(0, 0, source.width, source.height))) {
        if (candidate.scale < .9) { searchIssue = "small"; continue; }
        for (let index = 0; index < recognizers.length; index++) {
          const adjusted = align(candidate, recognizers[index]);
          if (!adjusted) continue;
          const result = recognizers[index].read(crop(adjusted), context);
          if (result.visible) { region = adjusted; active = index; observation = result; break; }
        }
        if (observation?.visible) break;
      }
    }
    if (observation?.visible) status.reset();
    else observation = { visible: false, issue: status.update(searchIssue, started) };
    self.postMessage({ type: "frame", id, observation,
      region, width: source.width, height: source.height, elapsed: performance.now() - started });
  } catch (error) { self.postMessage({ type: "frame", id, observation: { visible: false, issue: "reader" }, error: { message: String(error?.message || error), stack: String(error?.stack || "") } }); }
  finally { bitmap.close(); }
};
