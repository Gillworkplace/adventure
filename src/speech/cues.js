export const CUE_OPTIONS = [
  ["recommendation", "推荐行动", "掷骰子与使用卡牌"],
  ["calculating", "推荐计算中", "等待计算完成时的提示"],
  ["window", "确认游戏窗口", "请求显示完整游戏窗口"],
  ["small", "放大画面", "文字难以阅读时请求放大"],
  ["covered", "关闭弹窗", "提示有弹窗遮挡游戏画面"],
  ["fields", "确认识别值", "请求确认分数·骰子·持有卡牌"],
  ["stale", "画面暂停", "请求重新显示共享中的窗口"],
  ["deckOpen", "打开卡牌历史", "请求在真实游戏中打开历史窗口"],
  ["deckScroll", "滚动卡牌历史", "提示滚动方向与稍作停顿的时机"],
  ["deckReady", "卡牌历史确认完成", "历史确认完成时的提示"],
  ["disconnected", "屏幕共享结束", "共享断开时的提示"],
  ["reader", "画面识别错误", "请求重新连接画面"],
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
