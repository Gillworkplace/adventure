export const CUE_OPTIONS = [
  ["recommendation", "추천 행동", "주사위 굴리기와 카드 사용"],
  ["calculating", "추천 계산 중", "계산을 기다리는 동안 안내"],
  ["window", "게임 창 확인", "게임 창 전체를 표시하도록 요청"],
  ["small", "화면 확대", "글자를 읽기 어려울 때 확대 요청"],
  ["covered", "팝업 닫기", "게임 화면을 가리는 팝업 안내"],
  ["fields", "인식값 확인", "점수·주사위·보유 카드 확인 요청"],
  ["stale", "화면 일시 중지", "공유 중인 창을 다시 표시하도록 요청"],
  ["deckOpen", "카드 이력 열기", "실제 게임에서 이력 창을 열도록 요청"],
  ["deckScroll", "카드 이력 스크롤", "스크롤 방향과 잠시 멈출 시점 안내"],
  ["deckReady", "카드 이력 확인 완료", "이력 확인이 끝났을 때 안내"],
  ["disconnected", "화면 공유 종료", "공유가 끊겼을 때 안내"],
  ["reader", "화면 인식 오류", "화면을 다시 연결하도록 요청"],
];
export const DEFAULT_CUES = Object.fromEntries(CUE_OPTIONS.map(([key]) => [key, true]));
const legacy = { window: "obstruction", small: "obstruction", covered: "obstruction", fields: "obstruction", stale: "obstruction",
  deckOpen: "deck", deckScroll: "deck", deckReady: "deck", disconnected: "connection", reader: "connection" };
export function normalizeCues(values = {}) {
  return Object.fromEntries(CUE_OPTIONS.map(([key]) => [key, (values?.[key] ?? values?.[legacy[key]]) !== false]));
}
export function cueCategory(clip) {
  if (clip === "deck-ready") return "deckReady";
  if (["deck-open", "deck-reopen", "deck-ingame"].includes(clip)) return "deckOpen";
  if (clip?.startsWith("deck-")) return "deckScroll";
  if (["score", "dice", "hand", "bonus"].includes(clip)) return "fields";
  return Object.hasOwn(DEFAULT_CUES, clip) ? clip : "recommendation";
}
