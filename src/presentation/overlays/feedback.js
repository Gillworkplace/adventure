import { dialog } from "./dialogs.js";

export function showFeedback(downloaded = false) {
  if (document.querySelector(".feedback-dialog")) return;
  const body = document.createElement("div");
  if (downloaded) {
    const status = document.createElement("p");
    status.textContent = "진단 정보 다운로드를 요청했습니다.";
    body.append(status);
  }
  const message = document.createElement("p");
  message.textContent = "문의·제보 접수 폼을 새 탭으로 열까요?";
  body.append(message);
  if (downloaded) {
    const hint = document.createElement("p");
    hint.className = "dialog-hint";
    hint.textContent = "저장된 진단 정보 파일은 접수 폼에 직접 첨부해 주세요.";
    body.append(hint);
  }
  const footer = document.createElement("footer");
  const open = document.createElement("button"), cancel = document.createElement("button");
  open.type = cancel.type = "button";
  open.className = "primary";
  open.textContent = "접수 폼 열기";
  cancel.textContent = downloaded ? "나중에" : "취소";
  footer.append(open, cancel);
  body.append(footer);
  const node = dialog("문의·제보", body, { className: "confirm-dialog feedback-dialog" });
  cancel.onclick = () => node.close();
  open.onclick = () => {
    const link = document.createElement("a");
    link.href = "https://tally.so/r/ja1EbR";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    // Keep navigation in the button click so browsers retain user activation.
    node.append(link);
    link.click();
    link.remove();
    node.close();
  };
  return node;
}
