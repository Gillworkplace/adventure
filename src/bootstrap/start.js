let probe, timer;
const checked = new Promise((resolve, reject) => {
  probe = new Worker(new URL("./probe-worker.js", import.meta.url), { type: "module" });
  timer = setTimeout(() => reject(Error("无法确认浏览器响应。请重试。")), 6000);
  probe.onmessage = ({ data }) => data === 73 ? resolve() : reject(Error("此浏览器请使用旧版本。"));
  probe.onerror = event => { event.preventDefault(); reject(Error("此浏览器请使用旧版本。")); };
});
checked.then(() => import("./main.js"))
  .then(() => window.adventureBoot.ready())
  .catch(error => { window.adventureDiagnostics?.capture(error, "boot.import"); console.error("Game loading failed", error); window.adventureBoot.fail("请检查浏览器和网络连接后重试，或使用旧版本。"); })
  .finally(() => { clearTimeout(timer); probe?.terminate(); });
