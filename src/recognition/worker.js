import { GameRecognizer, findGameRegion } from "./vision.js";
import { RecognitionStatus } from "./status.js";
import { CharacterProbe } from "./character.js";

let recognizer, region, sourceSize, lastSearch = -Infinity;
let searchIssue = "window";
const status = new RecognitionStatus();
const source = new OffscreenCanvas(1, 1), screen = new OffscreenCanvas(1234, 694);
const input = source.getContext("2d", { willReadFrequently: true });
const output = screen.getContext("2d", { willReadFrequently: true });
const anchorCanvas = new OffscreenCanvas(103, 14), anchorOutput = anchorCanvas.getContext("2d", { willReadFrequently: true });

function crop(rect) {
  output.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, 1234, 694);
  return screen.getContext("2d").getImageData(0, 0, 1234, 694);
}
function align(rect) {
  const a = recognizer.anchor;
  let best = null, score = 0;
  for (const dy of [0, -.5, .5, -1, 1]) for (const dx of [0, -.5, .5, -1, 1]) {
    const x = rect.x + dx * rect.scale, y = rect.y + dy * rect.scale;
    anchorOutput.drawImage(source, x + a.x * rect.scale, y + a.y * rect.scale, a.width * rect.scale, a.height * rect.scale, 0, 0, a.width, a.height);
    const match = recognizer.anchorScore(anchorOutput.getImageData(0, 0, a.width, a.height));
    if (match > score) { score = match; best = { ...rect, x, y }; }
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
      const response = await fetch(new URL("../../public/recognition/game.json", import.meta.url));
      if (!response.ok) throw Error("Recognition templates unavailable");
      const templates = await response.json();
      recognizer = new GameRecognizer(templates);
      self.postMessage({ type: "ready" });
      characters.then(value => { if (Array.isArray(value)) recognizer.character = new CharacterProbe(value); });
    } catch (error) { self.postMessage({ type: "error", issue: "reader", error: { message: String(error?.message || error), stack: String(error?.stack || "") } }); }
    return;
  }
  const { bitmap, id, context } = data;
  if (!bitmap) return;
  const started = performance.now();
  try {
    if (!recognizer) throw Error("Reader unavailable");
    const size = bitmap.width + "x" + bitmap.height;
    if (size !== sourceSize) { region = null; lastSearch = -Infinity; searchIssue = "window"; status.reset(); sourceSize = size; source.width = bitmap.width; source.height = bitmap.height; }
    input.drawImage(bitmap, 0, 0);
    let observation = region ? recognizer.read(crop(region), context) : null;
    if (!observation?.visible && started - lastSearch > 1200) {
      lastSearch = started;
      searchIssue = region ? "covered" : "window";
      for (const candidate of findGameRegion(input.getImageData(0, 0, source.width, source.height))) {
        const adjusted = align(candidate);
        if (!adjusted) continue;
        if (candidate.scale < .9) { searchIssue = "small"; continue; }
        const result = recognizer.read(crop(adjusted), context);
        if (result.visible) { region = adjusted; observation = result; break; }
      }
    }
    if (observation?.visible) status.reset();
    else observation = { visible: false, issue: status.update(searchIssue, started) };
    self.postMessage({ type: "frame", id, observation,
      region, width: source.width, height: source.height, elapsed: performance.now() - started });
  } catch (error) { self.postMessage({ type: "frame", id, observation: { visible: false, issue: "reader" }, error: { message: String(error?.message || error), stack: String(error?.stack || "") } }); }
  finally { bitmap.close(); }
};
