import { dialog } from "./dialogs.js";

export function showFeedback(downloaded = false) {
  if (document.querySelector(".feedback-dialog")) return;
  const body = document.createElement("div");
  if (downloaded) {
    const status = document.createElement("p");
    status.textContent = "已请求下载诊断信息。";
    body.append(status);
  }
  const message = document.createElement("p");
  message.textContent = "要在新标签页打开咨询·反馈表单吗？";
  body.append(message);
  if (downloaded) {
    const hint = document.createElement("p");
    hint.className = "dialog-hint";
    hint.textContent = "请将保存的诊断信息文件直接附加到反馈表单。";
    body.append(hint);
  }
  const footer = document.createElement("footer");
  const open = document.createElement("button"), cancel = document.createElement("button");
  open.type = cancel.type = "button";
  open.className = "primary";
  open.textContent = "打开反馈表单";
  cancel.textContent = downloaded ? "稍后" : "取消";
  footer.append(open, cancel);
  body.append(footer);
  const node = dialog("咨询·反馈", body, { className: "confirm-dialog feedback-dialog" });
  cancel.onclick = () => node.close();
  open.onclick = () => {
    const link = document.createElement("a");
    link.href = "https://tally.so/r/ja1EbR";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    // 把导航放在按钮点击内执行，以便浏览器保留用户激活状态。
    node.append(link);
    link.click();
    link.remove();
    node.close();
  };
  return node;
}
