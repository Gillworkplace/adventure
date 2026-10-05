(function () {
  var script = document.currentScript || document.scripts[document.scripts.length - 1];
  var base = script.src.slice(0, script.src.lastIndexOf("/") + 1);
  var link = document.getElementById("legacy-link");
  link.href = link.href + location.search + location.hash;
  var timer, failed = false;
  window.adventureBoot = {
    ready: function () { clearTimeout(timer); if (!failed && window.adventureDiagnostics) window.adventureDiagnostics.record("boot.ready"); },
    fail: function (message) {
      failed = true;
      clearTimeout(timer);
      document.getElementById("loading-status").textContent = "无法准备画面。";
      document.getElementById("loading-detail").textContent = message || "请更新浏览器，或使用旧版本。";
      document.getElementById("loading-progress").removeAttribute("value");
      document.getElementById("loading-percent").textContent = "";
      document.getElementById("boot-retry").hidden = false;
      if (window.adventureDiagnostics) {
        window.adventureDiagnostics.capture(new Error(message || "Boot failed"), "boot.failure");
        document.getElementById("boot-diagnostics").hidden = false;
      }
    }
  };
  document.getElementById("boot-retry").onclick = function () { location.reload(); };
  document.getElementById("boot-diagnostics").onclick = function () {
    if (window.adventureDiagnostics) {
      if (window.adventureDiagnostics.download()) window.adventureFeedback.confirmOpen(true);
      else document.getElementById("loading-detail").textContent = "无法保存文件。请检查浏览器的下载设置。";
    }
  };
  if (!("noModule" in document.createElement("script")) || !window.Promise || !window.fetch || !window.AbortController || !window.Worker) {
    window.adventureBoot.fail("此浏览器请使用旧版本。");
    return;
  }
  var entry = document.createElement("script");
  entry.type = "module";
  entry.src = base + "start.js";
  entry.onerror = function () { window.adventureBoot.fail(); };
  timer = setTimeout(function () { window.adventureBoot.fail("请检查网络连接后重试，或使用旧版本。"); }, 20000);
  document.body.appendChild(entry);
}());
