import { tiles } from "../../rules/index.js";
import { stageNames } from "../../content/board-layout.js";
import { cardLabels, cardIcons } from "../../content/cards.js";
export const number = (n, digits = 1) =>
  Number.isFinite(n)
    ? n.toLocaleString("ko-KR", { maximumFractionDigits: digits })
    : "—";
export class GameView {
  constructor(assets) {
    this.assets = assets;
    this.rows = [];
    this.hand = [];
    this.info = [];
    this.tableRows = [];
    for (let a = 0; a < 6; a++) {
      const b = document.createElement("button");
      b.className = "estimate-row";
      b.dataset.action = a;
      b.textContent = (a ? `${a}号卡牌` : "骰子") + ": —";
      document.querySelector("#estimates").append(b);
      this.rows.push(b);
      const row = document.createElement("tr");
      for (let i = 0; i < 7; i++) row.append(document.createElement("td"));
      document.querySelector("#overview-body").append(row);
      this.tableRows.push(row);
    }
    for (let a = 1; a <= 5; a++) {
      const b = document.createElement("button");
      b.className = "hand-button";
      b.dataset.slot = a;
      b.innerHTML = '<span class="card-sprite" hidden></span><span class="card-fallback" hidden></span>';
      document.querySelector("#hand").append(b);
      this.hand.push(b);
    }
    for (let id = 1; id <= 30; id++) {
      const b = document.createElement("button");
      b.className = "card-info-row";
      b.dataset.card = id;
      document.querySelector("#card-info-list").append(b);
      this.info.push(b);
    }
    for (let sum = 2; sum <= 12; sum++) {
      const b = document.createElement("button");
      b.textContent = "+" + sum;
      b.dataset.sum = sum;
      b.setAttribute("aria-label", `${sum}格直接移动`);
      document.querySelector("#dice-buttons").append(b);
    }
  }
  render(session, result) {
    // 辅助模式正在观察一个动作期间，保留之前的数值用于显示。
    // 协调器/语音仍然只接收实际的当前结果。
    const stateKey = JSON.stringify(session.state);
    if (session.mode !== "assist" || result.status === "disabled" ||
        this.assistDisplay?.stateKey !== stateKey || this.assistDisplay?.result.model !== result.model)
      this.assistDisplay = null;
    if (session.mode === "assist" && session.canRecommend && result.status === "complete" &&
        result.revision === session.revision)
      this.assistDisplay = { stateKey, result };
    const holding = session.mode === "assist" && !session.canRecommend &&
      result.status === "paused" && !!this.assistDisplay;
    if (holding) result = this.assistDisplay.result;
    const s = session.state,
      t = tiles[s.position - 1],
      automatic = session.mode === "automatic",
      assisting = session.mode === "assist",
      modeName = { automatic: "本地试玩", manual: "手动", assist: "辅助" }[session.mode],
      disabled = result.status === "disabled",
      vela = result.model === "vela" || result.profile?.model === "vela";
    const text = (id, value) =>
      (document.getElementById(id).textContent = value);
    text("settings-button", "模型选择");
    document.querySelector("#settings-button").dataset.model = vela ? "vela" : "x36";
    const overview = document.querySelector("#score-overview");
    document.querySelector("#compare-button").disabled = disabled || !session.canRecommend;
    for (const id of ["position-button", "dice-used-button", "reset-button", "prev-stage", "next-stage"])
      document.getElementById(id).disabled = assisting;
    overview.classList.toggle("vela-overview", vela);
    overview.setAttribute("aria-label", vela ? "行动评估比较" : "预期分数整体比较");
    overview.querySelector("header strong").textContent = vela ? "行动评估" : "预期分数整体比较";
    overview.querySelector(".legend").innerHTML = vela
      ? "<b class=recommended>推荐</b>: 评估最高的选择。数值越大越有利，并非最终分数预测。"
      : "<b class=recommended>推荐</b>: 当前平均分最高的选择 · <b class=near>接近</b>: 差距较小、难分优劣的选择 · <b class=candidate>候选</b>: 尚未被排除的选择";
    text("position", s.position);
    text("stage-name", `${t.stage}.${stageNames[t.stage - 1]}`);
    text("stage-position", t.ordinal);
    text("dice-used", s.diceUsed);
    const forecast = result.forecast || {};
    text("forecast-label", forecast.terminal ? "最终分数" : "预期最终分数");
    text("forecast-value", Number.isFinite(forecast.value) ? number(forecast.value, 0) + "分" : forecast.pending ? "计算中…" : "—");
    document.getElementById("forecast-value").title = holding ? "这是上一次确认状态下的预期分数。" : "";
    text("forecast-delta", forecast.delta ? `(${forecast.delta > 0 ? "+" : ""}${number(forecast.delta, 0)})` : "");
    document.querySelector("#forecast-delta").dataset.direction = forecast.delta > 0 ? "up" : "down";
    overview.querySelector(".legend").append(document.createElement("br"), document.createTextNode(vela
      ? "预期最终分数是持续采用 VELA 推荐时的预测。括号内为相对上一状态的变化。"
      : "预期最终分数是持续采用 G3-R100K 推荐时的预测。括号内为相对上一状态的变化。"));
    text("high-score", session.highScore + " 格");
    text(
      "board-description",
      `${stageNames[t.stage - 1]}，当前第 ${s.position} 格，关卡第 ${t.ordinal} 格，已使用骰子 ${s.diceUsed} 次。${modeName}模式。`,
    );
    const roll = document.querySelector("#roll-button");
    roll.classList.toggle("is-double", s.bonusRoll);
    roll.setAttribute(
      "aria-label",
      automatic
        ? "掷骰子"
        : `切换双骰状态 (${s.bonusRoll ? "双骰" : "普通"})`,
    );
    roll.disabled = assisting || automatic && session.terminal;
    document
      .querySelector("#mode-button")
      .setAttribute(
        "aria-label",
        `切换模式 (当前${modeName})`,
      );
    document
      .querySelectorAll("[data-sum]")
      .forEach((b) => (b.disabled = assisting || automatic || session.terminal));
    this.hand.forEach((b, i) => {
      b.disabled = assisting;
      const id = s.hand[i],
        icon = b.firstElementChild;
      b.setAttribute(
        "aria-label",
        id
          ? `${i + 1}号卡牌: ${cardLabels[id - 1]}`
          : `${i + 1}号空卡牌槽位: 获得卡牌`,
      );
      const imageReady = !this.assets || !!this.assets.get(78);
      icon.hidden = !id || !imageReady;
      b.lastElementChild.hidden = !id || imageReady;
      b.lastElementChild.textContent = id ? cardLabels[id - 1].replace("前进 ", "+").replace("后退 ", "−").replace(" 格", "").replace("骰子 ", "").replace(/!+/g, "").replace("移动到下一关卡的第一格", "NEXT").trim() : "";
      b.dataset.cardId = id || "";
      if (id) {
        const index = cardIcons[id - 1];
        icon.style.backgroundPosition = `-${(index % 31) * 33}px -${Math.floor(index / 31) * 33 + 921}px`;
      }
    });
    this.info.forEach((b, i) => {
      b.disabled = assisting;
      const obtained = !(s.deckAvailable & (1 << i));
      b.classList.toggle("obtained", obtained);
      b.textContent = (obtained ? "✔ " : "■ ") + cardLabels[i];
      b.setAttribute("aria-pressed", String(obtained));
    });
    const statusLabels = {
      recommended: "推荐",
      active: "候选",
      pruned: "排除",
      pending: "计算中",
      terminal: "结束",
      evaluated: "比较",
    };
    this.rows.forEach((b, a) => {
      b.disabled = !session.canRecommend;
      const available = a === 0 || a <= s.hand.length,
        r = result.actions?.[a],
        score = vela ? r?.value : r?.mean;
      let value = disabled || !session.canRecommend && !holding ? "—" : !available
        ? (vela ? "—" : "0.000分")
        : result.status === "error"
          ? "错误"
          : score !== null && score !== undefined
            ? score.toFixed(3) + (vela ? "" : "分")
            : result.status === "running"
              ? "计算中..."
              : "—";
      b.textContent = (a ? `${a}号卡牌` : "骰子") + ": " + value;
      b.title = holding ? "这是上一次确认状态下的评估值。" : "";
      b.classList.toggle("is-near", session.canRecommend && (!!r?.near || (vela && result.recommended?.includes(a))));
      b.setAttribute("aria-label", `${b.textContent}, ${disabled ? "选择模型" : "重新计算"}`);
      const row = this.tableRows[a],
        recommended = session.canRecommend && result.recommended?.includes(a),
        near = session.canRecommend && r?.near && !recommended;
      row.className = recommended ? "recommended" : near ? "near" : "";
      row.dataset.available = String(available);
      const center = vela ? r?.value : result.profile?.engine === "cpu" ? r?.median : r?.mean;
      const status = !available
        ? "空"
        : holding
          ? "上次值"
        : result.status === "error"
          ? "错误"
          : recommended
            ? "推荐"
            : near
              ? "接近"
              : statusLabels[r?.status] ||
                (result.status === "running" ? "计算中" : "—");
      const values = [
        a
          ? `${a}号卡牌${s.hand[a - 1] ? " · " + cardLabels[s.hand[a - 1] - 1] : ""}`
          : "骰子",
        available ? number(center, vela ? 3 : 0) : "—",
        available && r?.count
          ? `${number(r.min, 0)} ~ ${number(r.max, 0)}`
          : "—",
        available && r?.ci
          ? `${number(r.ci[0], 0)} ~ ${number(r.ci[1], 0)}`
          : "—",
        available ? number(r?.count, 0) : "—",
        available ? number(r?.gap) : "—",
        status,
      ];
      const labels = ["行动", vela ? "评估值" : result.profile?.engine === "cpu" ? "中位数" : "平均", "范围", "95% CI", "样本", "推荐差", "状态"];
      values.forEach((v, i) => { row.children[i].textContent = v; row.children[i].dataset.label = labels[i]; });
    });
    text("center-label", vela ? "评估值" : result.profile?.engine === "cpu" ? "中位数" : "平均");
    text(
      "evaluation-detail",
      result.status === "error"
        ? result.message
        : result.elapsedMs !== undefined
          ? vela ? `${result.modelName} · ${number(result.elapsedMs / 1000, 3)}秒` : `${result.profile?.engine.toUpperCase()} · G3 · ${number(result.elapsedMs / 1000, 2)}秒 · 实际 ${number(result.totalSamples, 0)} 次${result.status === "running" ? " · 计算中" : ""}`
          : "",
    );
  }
}
