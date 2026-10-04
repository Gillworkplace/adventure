export class CaptureFrames {
  constructor(stream) {
    this.sequence = 0;
    const track = stream.getVideoTracks?.()[0];
    if (typeof globalThis.MediaStreamTrackProcessor !== "function" || !track?.clone) return;
    try {
      this.track = track.clone();
      this.reader = new MediaStreamTrackProcessor({ track: this.track, maxBufferSize: 1 }).readable.getReader();
      this.active = true;
      this.read();
    } catch { this.stop(); }
  }
  async read() {
    try {
      while (!this.stopped) {
        const { value: frame, done } = await this.reader.read();
        if (done) break;
        if (this.stopped) { frame?.close(); break; }
        const now = performance.now(), timestamp = frame.timestamp / 1000;
        if (!Number.isFinite(timestamp) || timestamp <= (this.timestamp ?? -Infinity)) { frame.close(); continue; }
        // Capture timestamps advance independently of video rendering. Keep
        // the smallest clock offset so a delayed delivery cannot become fresh.
        this.offset = Math.min(this.offset ?? Infinity, now - timestamp);
        this.timestamp = timestamp;
        this.frame?.close(); this.frame = frame;
        this.at = timestamp + this.offset;
        this.sequence++;
      }
    } catch {}
    finally { this.stop(); }
  }
  async bitmap() {
    if (!this.frame || this.stopped) return null;
    const frame = this.frame.clone();
    try { return await createImageBitmap(frame); }
    finally { frame.close(); }
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true; this.active = false;
    this.frame?.close(); this.frame = null;
    this.reader?.cancel().catch(() => {});
    this.track?.stop();
  }
}
