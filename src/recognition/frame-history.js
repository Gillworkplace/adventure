// Retained pixels contain only score, hand, and dice information. Profile,
// board, deck, and the shared desktop are never retained in this history.
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
  clear() { this.frames = []; this.bytes = 0; }
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
    let reread = 0;
    for (const frame of this.frames) {
      if (frame.at <= after || frame.at > before || !frame.observation?.visible) continue;
      let observation = frame.observation;
      if (observation.issue && performance.now() - started < maxMs) {
        const image = { width: 1234, height: 694, data: new Uint8ClampedArray(1234 * 694 * 4) };
        for (const part of frame.parts) for (let y = 0; y < part.height; y++) {
          image.data.set(part.pixels.subarray(y * part.width * 4, (y + 1) * part.width * 4),
            ((part.y + y) * image.width + part.x) * 4);
        }
        observation = { ...recognizer.readCore(image, { retained: true }), overlay: !!frame.observation.overlay };
        reread++;
      }
      rows.push({ at: frame.at, observation });
    }
    // Only parsed values leave this worker; the retained pixels stay private.
    return { rows, reread };
  }
}
