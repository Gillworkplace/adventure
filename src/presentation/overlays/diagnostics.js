import { diagnostics } from "../../platform/report.js";
import { dialog, toast } from "./dialogs.js";
import { notify, dismissNotification } from "./notifications.js";

export function showDiagnostics({ onSaved } = {}) {
  if (document.querySelector(".diagnostics-dialog")) return;
  const body = document.createElement("div");
  body.innerHTML = '<p>将保存用于排查问题的游戏·浏览器信息。咨询时请附加该文件。</p><p class="dialog-hint">不会自动发送。</p><footer><button type="button" class="primary">保存文件</button><button type="button" class="diagnostics-cancel">取消</button></footer>';
  const node = dialog("诊断信息", body, { className: "diagnostics-dialog" });
  body.querySelector(".diagnostics-cancel").onclick = () => node.close();
  body.querySelector(".primary").onclick = () => {
    if (diagnostics.download()) {
      node.close();
      onSaved?.();
      globalThis.adventureFeedback.confirmOpen(true);
    }
    else toast("无法保存文件。请检查浏览器的下载设置。");
  }
  return node;
}
export function bindDiagnostics() {
  diagnostics.subscribe(() => {
    notify("diagnostics", "如果问题反复出现，请一并提供诊断信息。", {
      tone: "warning", duration: 8000, actionLabel: "诊断信息",
      action: () => { dismissNotification("diagnostics"); showDiagnostics(); },
    });
  });
}
