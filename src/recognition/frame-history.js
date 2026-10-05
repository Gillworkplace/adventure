// 保留的像素只包含分数、手牌和骰子信息。资料面板、棋盘、
// 牌库以及共享桌面绝不保留在此历史中。
export const HISTORY_REGIONS = Object.freeze([
  { name: "score", x: 74, y: 55, width: 51, height: 21 },
  { name: "hand", x: 420, y: 638, width: 220, height: 42 },
  { name: "dice", x: 16, y: 540, width: 176, height: 70 },
  { name: "dice", x: 128, y: 659, width: 35, height: 27 },
]);
export class FrameHistory {
  constructor({ maxBytes = 32 * 1024 * 1024, maxAgeMs = 30000 } = {}) {
    this.maxBytes = maxBytes; this.maxAgeMs = maxAgeMs; this.clear();
  }
  clear() { this.frames = []; this.bytes = 0; this.replayImage = null; }
  prune(at) {
    while (this.frames.length && (this.bytes > this.maxBytes || at - this.frames[0].at > this.maxAgeMs)) this.bytes -= this.frames.shift().bytes;
  }
  add(image, at, observation) {
    if (!Number.isFinite(at) || at <= (this.frames.at(-1)?.at ?? -Infinity)) return false;
    const parts = HISTORY_REGIONS.map(rect => {
      const pixels = new Uint8ClampedArray(rect.width * rect.height * 4);
      for (let y = 0; y < rect.height; y++) {
        const start = ((rect.y + y) * image.width + rect.x) * 4;
        pixels.set(image.data.subarray(start, start + rect.width * 4), y * rect.width * 4);
      }
      return { ...rect, pixels };
    });
    const bytes = parts.reduce((n, part) => n + part.pixels.byteLength, 0);
    if (bytes > this.maxBytes) return false;
    this.frames.push({ at, observation, parts, bytes }); this.bytes += bytes;
    this.prune(at);
    return true;
  }
  get stats() {
    return { frames: this.frames.length, bytes: this.bytes, maxBytes: this.maxBytes,
      retainedMs: this.frames.length ? this.frames.at(-1).at - this.frames[0].at : 0 };
  }
  replay(recognizer, after, before, { maxMs = 8 } = {}) {
    const started = performance.now(), rows = [];
    let reread = 0, pending = false;
    for (const frame of this.frames) {
      if (frame.at <= after || frame.at > before || !frame.observation?.visible) continue;
      let observation = frame.replayed ?? frame.observation;
      if (observation.issue && !frame.replayed && performance.now() - started < maxMs) {
        const image = this.replayImage ||= { width: 1234, height: 694, data: new Uint8ClampedArray(1234 * 694 * 4) };
        for (const part of frame.parts) for (let y = 0; y < part.height; y++) {
          image.data.set(part.pixels.subarray(y * part.width * 4, (y + 1) * part.width * 4),
            ((part.y + y) * image.width + part.x) * 4);
        }
        observation = { ...recognizer.readCore(image, { retained: true,
          illumination: frame.observation.illumination }), overlay: !!frame.observation.overlay };
        frame.replayed = observation;
        reread++;
      }
      else if (observation.issue && !frame.replayed) pending = true;
      rows.push({ at: frame.at, observation });
    }
    // 只有解析后的数值才会离开此 worker；保留的像素保持私有。
    return { rows, reread, pending };
  }
}
