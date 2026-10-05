import { diagnostics } from "./report.js";

// 本地服务器窗口捕获：轮询 /capture/frame 并在画布上合成 MediaStream。
// 用于 getDisplayMedia 不可用的嵌入式浏览器；仅在同源本地服务器下启用。
export function localCaptureSupport() {
  const location = globalThis.location;
  if (!location || !globalThis.isSecureContext || location.protocol !== "http:") return { available: false };
  const host = location.hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
  return { available: local && typeof document.createElement("canvas").captureStream === "function" };
}

export async function listLocalWindows(signal) {
  const response = await fetch("/capture/windows", { signal, cache: "no-store" });
  if (!response.ok) throw Error("本地窗口列表不可用");
  const windows = await response.json();
  return Array.isArray(windows) ? windows : [];
}

export async function captureLocalWindow({ hwnd }) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  let stopped = false, failures = 0, timer = null;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    if (track.readyState === "live") track.stop();
  };
  // assist 释放轨道时同步终止轮询；连续失败同样结束轨道，让上层走 ended 清理流程。
  track.addEventListener("ended", stop);
  stream.addEventListener("inactive", stop);
  const pump = async () => {
    if (stopped) return;
    try {
      const response = await fetch(`/capture/frame?hwnd=${hwnd}`, { cache: "no-store" });
      if (!response.ok) throw new DOMException(response.statusText || "capture failed", "NotAllowedError");
      const bitmap = await createImageBitmap(await response.blob());
      if (stopped) { bitmap.close(); return; }
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      failures = 0;
      track.requestFrame?.();
      timer = setTimeout(pump, 30);
    } catch (error) {
      diagnostics.record("assist.localCapture", { stage: "frame", message: String(error?.message || error) });
      if (++failures > 8) { stop(); return; }
      timer = setTimeout(pump, 300);
    }
  };
  pump();
  return stream;
}
