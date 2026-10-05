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

// 裁剪区域按窗口句柄保存在 localStorage：{ hwnd, x, y, w, h }（窗口像素坐标）。
// 轮询时每次读取，便于设置后立即生效而无需重连。
export function localCrop(hwnd) {
  try {
    const crop = JSON.parse(localStorage.getItem("adventure.localCrop") || "null");
    if (crop && crop.hwnd === hwnd && crop.w > 8 && crop.h > 8) return crop;
  } catch { }
  return null;
}

export function setLocalCrop(hwnd, rect) {
  if (rect) localStorage.setItem("adventure.localCrop", JSON.stringify({ hwnd, ...rect }));
  else localStorage.removeItem("adventure.localCrop");
}

export function captureLocalWindow({ hwnd }) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    let stream = null, track = null, stopped = false, failures = 0, timer = null;
    // assist 释放轨道时同步终止轮询；连续失败同样结束轨道，让上层走 ended 清理流程。
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      if (track && track.readyState === "live") track.stop();
    };
    const pump = async () => {
      if (stopped) return;
      try {
        const response = await fetch(`/capture/frame?hwnd=${hwnd}`, { cache: "no-store" });
        if (!response.ok) throw new DOMException(response.statusText || "capture failed", "NotAllowedError");
        const bitmap = await createImageBitmap(await response.blob());
        if (stopped) { bitmap.close(); return; }
        if (!stream) {
          // 先按首帧尺寸设置画布，再创建流：流轨道尺寸在建流时固定，
          // 之后改画布尺寸会导致画面只剩左上角区域。
          const crop = localCrop(hwnd);
          canvas.width = crop ? crop.w : bitmap.width;
          canvas.height = crop ? crop.h : bitmap.height;
          stream = canvas.captureStream(0);
          track = stream.getVideoTracks()[0];
          track.addEventListener("ended", stop);
          stream.addEventListener("inactive", stop);
        }
        // 裁剪区域变化时按画布尺寸等比缩放绘制（居中留边），避免拉伸变形。
        const crop = localCrop(hwnd);
        context.fillStyle = "#000";
        context.fillRect(0, 0, canvas.width, canvas.height);
        const sx = crop && crop.x + crop.w <= bitmap.width && crop.y + crop.h <= bitmap.height ? crop.x : 0;
        const sy = crop && crop.x + crop.w <= bitmap.width && crop.y + crop.h <= bitmap.height ? crop.y : 0;
        const sw = crop && sx ? crop.w : bitmap.width;
        const sh = crop && sy ? crop.h : bitmap.height;
        const scale = Math.min(canvas.width / sw, canvas.height / sh);
        const dw = sw * scale, dh = sh * scale;
        context.drawImage(bitmap, sx, sy, sw, sh, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
        bitmap.close();
        failures = 0;
        resolve(stream);
        track.requestFrame?.();
        timer = setTimeout(pump, 30);
      } catch (error) {
        diagnostics.record("assist.localCapture", { stage: "frame", message: String(error?.message || error) });
        if (++failures > 8) { stop(); reject(error); return; }
        timer = setTimeout(pump, 300);
      }
    };
    pump();
  });
}
