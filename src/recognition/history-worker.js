import { GameRecognizer } from "./vision.js";
import { FrameHistory } from "./frame-history.js";

const history = new FrameHistory();
const source = new OffscreenCanvas(1, 1), screen = new OffscreenCanvas(1234, 694);
const input = source.getContext("2d"), output = screen.getContext("2d", { willReadFrequently: true });
let recognizer, regionKey;
self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      const response = await fetch(new URL("../../public/recognition/game.json", import.meta.url));
      if (!response.ok) throw Error("History templates unavailable");
      recognizer = new GameRecognizer(await response.json());
      self.postMessage({ type: "ready" });
    } catch { self.postMessage({ type: "disabled" }); }
    return;
  }
  const { bitmap, region, at, id } = data;
  if (!bitmap) return;
  try {
    const key = JSON.stringify([bitmap.width, bitmap.height, region]);
    if (key !== regionKey) { history.clear(); regionKey = key; }
    if (source.width !== bitmap.width || source.height !== bitmap.height) { source.width = bitmap.width; source.height = bitmap.height; }
    input.drawImage(bitmap, 0, 0);
    output.drawImage(source, region.x, region.y, region.width, region.height, 0, 0, 1234, 694);
    const image = output.getImageData(0, 0, 1234, 694);
    const observation = recognizer.readCore(image, { allowOverlay: true });
    if (observation.visible) history.add(image, at, observation);
    else history.prune(at);
    self.postMessage({ type: "frame", id, at, region, observation, history: history.stats });
  } catch { self.postMessage({ type: "frame", id, at, region, observation: { visible: false }, history: history.stats }); }
  finally { bitmap.close(); }
};
