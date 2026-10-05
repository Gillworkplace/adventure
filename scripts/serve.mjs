import http from "node:http";
import { stat, realpath } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, extname, sep, basename, join } from "node:path";
const root = await realpath(resolve(import.meta.dirname, ".."));
const port = Number(process.env.PORT || (basename(root).toLowerCase() === "adventure_v2" ? 4174 : 4173));

// ===== 本地窗口捕获：窗口列表 + 按窗口抓帧。WGC（Windows Graphics Capture）
// 不受窗口遮挡影响；若编译或启动失败，自动回退到 BitBlt（要求窗口不被遮挡）。=====
const captureDir = join(root, "scripts", "capture");
const winDir = process.env.SystemRoot || "C:/Windows";
const cscExe = join(winDir, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");

async function compileWgcHelper() {
  const dll = join(captureDir, "wgc_helper.dll");
  const cs = join(captureDir, "wgc-helper.cs");
  const csStat = await stat(cs);
  try { if ((await stat(dll)).mtimeMs >= csStat.mtimeMs) return true; } catch { }
  const sys = join(winDir, "System32", "WinMetadata");
  const args = ["-nologo", "-target:library", "-optimize+", `-out:${dll}`,
    "-r:" + join(winDir, "Microsoft.NET", "Framework64", "v4.0.30319", "System.Runtime.dll"),
    "-r:" + join(sys, "Windows.Graphics.winmd"),
    "-r:" + join(sys, "Windows.Foundation.winmd"),
    "-r:" + join(sys, "Windows.Storage.winmd"), cs];
  return new Promise((resolve, reject) => {
    const child = spawn(cscExe, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`csc exit ${code}`)));
  });
}
const wgcHelperReady = compileWgcHelper().then(() => true).catch(() => false);

function spawnWorker(mode, hwnd) {
  const file = join(captureDir, mode === "wgc" ? "wgc-worker.ps1" : "bitblt-worker.ps1");
  const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file];
  if (mode === "wgc") args.push(String(hwnd));
  return spawn("powershell.exe", args, { stdio: ["pipe", "pipe", "ignore"] });
}

const workers = new Map(); // hwnd -> { mode, child, queue, active, gotFrame, buffer }

function settleQueue(hwnd) {
  const state = workers.get(hwnd);
  if (!state || state.active || !state.queue.length) return;
  state.active = state.queue.shift();
  if (!state.child || state.child.exitCode != null) {
    state.child = spawnWorker(state.mode, hwnd);
    state.child.stdout.setEncoding("utf8");
    state.child.stdout.on("data", chunk => {
      state.buffer += chunk;
      let index;
      while ((index = state.buffer.indexOf("\n")) >= 0) {
        const line = state.buffer.slice(0, index).trim();
        state.buffer = state.buffer.slice(index + 1);
        if (line) handleWorkerLine(hwnd, line);
      }
    });
    state.child.on("exit", () => {
      state.child = null;
      const job = state.active;
      state.active = null;
      job?.reject(Object.assign(new Error("capture worker exited"), { statusCode: 500 }));
      settleQueue(hwnd);
    });
  }
  state.child.stdin.write(`CAP ${hwnd}\n`, error => {
    if (!error) return;
    const job = state.active;
    state.active = null;
    job?.reject(Object.assign(new Error(error.message || "capture write failed"), { statusCode: 500 }));
    settleQueue(hwnd);
  });
}

function handleWorkerLine(hwnd, line) {
  const state = workers.get(hwnd);
  if (!line.startsWith("FRAME ") && !line.startsWith("ERR ")) return; // READY 等握手行
  if (state.mode === "wgc" && !state.gotFrame && line.startsWith("ERR ")) {
    // 该窗口无法使用 WGC：记下来，改用 BitBlt 并重发当前任务。
    state.mode = "bitblt";
    const job = state.active;
    state.active = null;
    const child = state.child;
    state.child = null;
    child.kill();
    if (job) state.queue.unshift(job);
    settleQueue(hwnd);
    return;
  }
  const job = state.active;
  if (!job) return;
  state.active = null;
  settleQueue(hwnd);
  if (line.startsWith("FRAME ")) { state.gotFrame = true; job.resolve(Buffer.from(line.slice(6), "base64")); }
  else job.reject(Object.assign(new Error(line.slice(4) || "capture failed"), { statusCode: 409 }));
}

async function captureFrame(hwnd) {
  const useWgc = await wgcHelperReady;
  if (!workers.has(hwnd)) {
    workers.set(hwnd, { mode: useWgc ? "wgc" : "bitblt", child: null, queue: [], active: null, gotFrame: false, buffer: "" });
  }
  const state = workers.get(hwnd);
  return new Promise((resolve, reject) => {
    state.queue.push({ resolve, reject });
    settleQueue(hwnd);
  });
}

async function listWindows() {
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(captureDir, "window-list.ps1")], { stdio: ["ignore", "pipe", "ignore"] });
  let out = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", chunk => out += chunk);
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", code => {
      if (code !== 0) return reject(new Error("window list failed"));
      const windows = JSON.parse(out || "[]");
      resolve(Array.isArray(windows) ? windows : [windows]);
    });
  });
}
let windowCache = { at: 0, value: null };

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".md": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".gz": "application/gzip",
};
const server = http.createServer(async (req, res) => {
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405);
    res.end();
    return;
  }
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/capture/windows") {
    try {
      if (!windowCache.value || Date.now() - windowCache.at > 2000) {
        windowCache = { at: Date.now(), value: await listWindows() };
      }
      const body = JSON.stringify(windowCache.value);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(String(error?.message || error));
    }
    return;
  }
  if (url.pathname === "/capture/frame") {
    const hwnd = Number(url.searchParams.get("hwnd"));
    if (!Number.isInteger(hwnd) || hwnd <= 0) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("missing hwnd");
      return;
    }
    try {
      const png = await captureFrame(hwnd);
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : png);
    } catch (error) {
      res.writeHead(error.statusCode || 500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(String(error?.message || error));
    }
    return;
  }
  try {
    let path = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (path.startsWith("/tests/reference/production/img/"))
      path = path.replace(
        "/tests/reference/production/img/",
        "/public/assets/",
      );
    let file = resolve(root, "." + path);
    if (file !== root && !file.startsWith(root + sep))
      throw Error("Outside workspace");
    if ((await stat(file)).isDirectory()) {
      if (!path.endsWith("/")) {
        res.writeHead(302, { Location: path + "/" + new URL(req.url, "http://localhost").search });
        res.end(); return;
      }
      file = resolve(file, "index.html");
    }
    file = await realpath(file);
    if (!file.startsWith(root + sep)) throw Error("Outside workspace");
    const info = await stat(file);
    res.writeHead(200, {
      "Content-Type": mime[extname(file)] || "application/octet-stream",
      "Content-Length": info.size,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") res.end();
    else {
      const stream = createReadStream(file);
      stream.on("error", () => res.destroy());
      res.on("close", () => stream.destroy());
      stream.pipe(res);
    }
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Adventure v2: http://127.0.0.1:${port}`),
);
