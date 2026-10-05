import { cards, tiles, FULL_DECK, RULES_VERSION } from "../rules/index.js";
import { project } from "../environment/projection.js";
import { resolveLanding } from "../environment/tables.js";

export const cardClass = id => {
  const card = cards[id];
  return card ? cards.findIndex(other => other?.type === card.type && other.value === card.value) : 0;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const classes = hand => hand.map(cardClass);
const core = observation => ({ position: observation.position, diceUsed: observation.diceUsed, bonusRoll: observation.bonusRoll, hand: observation.hand });
const keyOf = observation => JSON.stringify(core(observation));
// 连续性启发式判断，不是对动作次数的证明，也不受语音帧龄上限
// 约束。短暂关闭窗口是跳过移动动画的正常方式。
const MAX_OBSERVATION_GAP_MS = 5000;
function hasObservationGap(records, after, until = Infinity) {
  let readableAt = after;
  for (const record of records) {
    if (record.at <= after || record.at > until) continue;
    if (record.at - readableAt > MAX_OBSERVATION_GAP_MS) return true;
    // 识别到但计数器/手牌不完整的游戏画面，仍能建立动画期间的屏幕
    // 连续性；但它不能确立一个已完成的状态。
    if (record.observation.visible || record.observation.partial) readableAt = record.at;
  }
  return false;
}
const idsFor = group => cards.slice(1).filter(card => cardClass(card.id) === group).map(card => card.id);

function handIds(hand, mask) {
  const used = new Map();
  return hand.map(group => {
    const ids = idsFor(group).sort((a, b) => Number(!!(mask & (1 << (a - 1)))) - Number(!!(mask & (1 << (b - 1)))));
    const index = used.get(group) || 0;
    used.set(group, index + 1);
    return ids[index % ids.length];
  });
}

function deckSignature(mask) {
  return deckGroups.map(bits => {
    let value = bits & mask, count = 0;
    while (value) { value &= value - 1; count++; }
    return count;
  }).join(",");
}
const deckGroups = cards.slice(1).filter(card => cardClass(card.id) === card.id)
  .map(card => idsFor(card.id).reduce((mask, id) => mask | (1 << (id - 1)), 0));

// 每次付费掷骰最多带来一次后续的免费掷骰。在最终时刻保留奖励会
// 占用那次免费掷骰；仅靠卡牌动作无法增加手牌数。
const remainingRolls = (state, target) => 2 * (target.diceUsed - state.diceUsed) +
  Number(state.bonusRoll) - Number(target.bonusRoll);
const handReachable = (state, target) => state.diceUsed <= target.diceUsed &&
  remainingRolls(state, target) >= 0 &&
  target.hand.length <= Math.min(5, state.hand.length + remainingRolls(state, target));

function cardReachability() {
  const destinations = new Map(), answers = new Map();
  const deterministic = cards.slice(1).filter(card => card.type !== 2 && cardClass(card.id) === card.id);
  return (from, target) => {
    if (from === target) return true;
    const key = target + ":" + from;
    if (answers.has(key)) return answers.get(key);
    // 把实际手牌/牌库放宽为全部确定性卡牌。在没有掷骰且手牌数相同
    // 的情况下，每个动作都必须抽一张牌。即使在这个更大的图中失败，
    // 也能证明不可达。因预算耗尽而停止则什么也证明不了。
    const started = performance.now(), pending = [from], seen = new Set(pending);
    for (let head = 0; head < pending.length; head++) {
      if (head >= 64 || performance.now() - started > .75) { answers.set(key, true); return true; }
      const position = pending[head];
      if (!destinations.has(position)) destinations.set(position, [...new Set(deterministic.map(card =>
        project({ position, diceUsed: 0, bonusRoll: false, hand: [card.id] }, 1).outcomes[0].score))]
        .filter(next => tiles[next - 1].event === 2));
      for (const next of destinations.get(position)) {
        if (next === target) { answers.set(key, true); return true; }
        if (!seen.has(next)) { seen.add(next); pending.push(next); }
      }
    }
    for (const position of seen) answers.set(target + ":" + position, false);
    return false;
  };
}

// 在任意大的前向移动（包括强制跳跃）下的下界。
// 反复的负单位步会放宽每张真实后退卡的移动量。
const forwardFloor = new Uint16Array(tiles.length + 1);
let landingFloor = tiles.length;
for (let position = tiles.length; position >= 1; position--) {
  landingFloor = Math.min(landingFloor, resolveLanding(position));
  forwardFloor[position] = Math.min(position, landingFloor);
}
for (let position = 1; position <= tiles.length; position++)
  if (forwardFloor[position] < position) forwardFloor[position] = forwardFloor[forwardFloor[position]];

function retainedHandPossible(hand, target, available) {
  for (let prefix = 0; prefix <= target.length; prefix++) {
    let matched = 0;
    for (const group of hand) if (matched < prefix && group === target[matched]) matched++;
    if (matched !== prefix) continue;
    const needed = new Map();
    for (const group of target.slice(prefix)) needed.set(group, (needed.get(group) || 0) + 1);
    if ([...needed].every(([group, count]) => count <= (available.get(group) || 0))) return true;
  }
  return false;
}

function handInventoryReachability() {
  const decks = new Map();
  return (state, target) => {
    if (!decks.has(state.deckAvailable)) {
      const counts = new Map(); let multipliers = 0, backward = 0;
      for (const card of cards.slice(1)) if (state.deckAvailable & (1 << (card.id - 1))) {
        const group = cardClass(card.id);
        counts.set(group, (counts.get(group) || 0) + 1);
        if (card.type === 2) multipliers++;
        if (card.type === 1 && card.value < 0) backward -= card.value;
      }
      decks.set(state.deckAvailable, { counts, multipliers, backward });
    }
    const deck = decks.get(state.deckAvailable), hand = classes(state.hand);
    const currentMultipliers = state.hand.filter(id => cards[id].type === 2).length;
    const targetMultipliers = target.hand.filter(id => cards[id].type === 2).length;
    // 重置需要抽完所有剩余的倍数卡。每张倍数卡要么留存在最终手牌
    // 中，要么在使用时消耗一次掷骰。若重置有可能成立，则刻意
    // 不启用这项库存证明。
    if (currentMultipliers + deck.multipliers - targetMultipliers <= remainingRolls(state, target)) return true;
    // 保留的卡牌仍是一个有序子序列，位于所有新抽卡牌之前。
    // 尝试把最终手牌按“保留前缀/新抽后缀”的所有切分方式进行验证。
    if (!retainedHandPossible(hand, target.hand, deck.counts)) return false;
    let backward = deck.backward;
    for (let slot = 0; slot < hand.length; slot++) {
      const card = cards[state.hand[slot]];
      if (card.type === 1 && card.value < 0 &&
          retainedHandPossible(hand.filter((_, index) => index !== slot), target.hand, deck.counts)) backward -= card.value;
    }
    let lowest = forwardFloor[state.position];
    for (let step = 0; step < backward; step++) lowest = forwardFloor[Math.max(1, lowest - 1)];
    return target.position >= lowest;
  };
}

function bonusOutcomes(previous, projection, outcome) {
  if (!projection.random) return [previous.bonusRoll];
  if (previous.bonusRoll) return [false];
  const values = [];
  if (outcome.sums.some(sum => sum > 2 && sum < 12)) values.push(false);
  if (outcome.sums.some(sum => sum % 2 === 0)) values.push(true);
  return values;
}

export function reconcileState(previous, observed) {
  const candidates = [];
  if (previous.diceUsed >= 100 && !previous.bonusRoll) return candidates;
  for (let action = 0; action <= previous.hand.length; action++) {
    const projection = project(previous, action), spec = action ? cards[previous.hand[action - 1]] : null;
    const outcome = projection.outcomes.find(outcome => outcome.score === observed.position);
    if (!outcome) continue;

    if (observed.diceUsed !== previous.diceUsed + projection.diceDelta) continue;
    if (!bonusOutcomes(previous, projection, outcome).includes(observed.bonusRoll)) continue;
    const hand = [...previous.hand];
    if (action) hand.splice(action - 1, 1);
    let mask = previous.deckAvailable, reset = false;
    const draw = tiles[observed.position - 1].event === 2 && hand.length < 5;
    if (observed.hand.length !== hand.length + Number(draw) || !same(observed.hand.slice(0, hand.length), classes(hand))) continue;
    if (draw) {
      const group = observed.hand.at(-1), id = idsFor(group).find(id => mask & (1 << (id - 1)));
      if (!id) continue;
      hand.push(id); mask &= ~(1 << (id - 1));
      if (!mask) { mask = FULL_DECK; reset = true; }
    }
    candidates.push({ state: { ...previous, ...core(observed), hand, deckAvailable: mask }, reset,
      action: { kind: !action ? "roll" : spec.type === 2 ? "multiplier" : "card", slot: action, sums: outcome.sums } });
  }
  const distinct = new Map();
  for (const candidate of candidates) {
    const key = keyOf({ ...candidate.state, hand: classes(candidate.state.hand) }) + ":" + deckSignature(candidate.state.deckAvailable);
    if (!distinct.has(key)) distinct.set(key, candidate);
  }
  return [...distinct.values()];
}

export function reconcileMultiStep(previous, observed) {
  const direct = reconcileState(previous, observed);
  if (direct.length) return direct;
  const candidates = resolveTransition(previous, observed);
  return candidates.length === 1 ? candidates : [];
}

// 让歧义保持可见，而不是回退到先前已接受的状态。
export function resolveTransition(previous, observed, { intermediate = null, firstActions = null, firstBonusRoll = null, directOnly = false, exhaustive = false } = {}) {
  if (exhaustive && !intermediate && !directOnly) {
    const shallow = resolveTransition(previous, observed, { firstActions, firstBonusRoll });
    if (shallow.length > 1) return shallow;
    return exploreTransition(previous, observed, { firstActions, firstBonusRoll });
  }
  const direct = intermediate ? [] : reconcileState(previous, observed)
    .filter(candidate => (!firstActions || firstActions.includes(candidate.action.slot)) &&
      (typeof firstBonusRoll !== "boolean" || candidate.state.bonusRoll === firstBonusRoll));
  if (directOnly) return direct;
  const diceDelta = observed.diceUsed - previous.diceUsed;
  if (diceDelta < 0 || diceDelta > 2) return direct;
  if (previous.diceUsed >= 100 && !previous.bonusRoll) return direct;

  const unique = new Map();
  const add = candidate => {
    const signature = keyOf({ ...candidate.state, hand: classes(candidate.state.hand) }) + ":" + deckSignature(candidate.state.deckAvailable);
    unique.set(signature, candidate);
  };
  direct.forEach(add);
  if (unique.size > 1) return [...unique.values()];
  for (let action1 = 0; action1 <= previous.hand.length; action1++) {
    if (firstActions && !firstActions.includes(action1)) continue;
    const proj1 = project(previous, action1);
    for (const outcome1 of proj1.outcomes) {
      const hand1 = [...previous.hand];
      if (action1) hand1.splice(action1 - 1, 1);
      const draw1 = tiles[outcome1.score - 1].event === 2 && hand1.length < 5;
      const draws = draw1 ? cards.slice(1).filter(card => previous.deckAvailable & (1 << (card.id - 1)))
        .filter((card, i, all) => all.findIndex(other => cardClass(other.id) === cardClass(card.id)) === i) : [null];
      for (const drawn of draws) for (const bonusRoll of bonusOutcomes(previous, proj1, outcome1)) {
        if (typeof firstBonusRoll === "boolean" && bonusRoll !== firstBonusRoll) continue;
        const mask = drawn ? previous.deckAvailable & ~(1 << (drawn.id - 1)) : previous.deckAvailable;
        const midState = {
          ...previous,
          position: outcome1.score,
          diceUsed: previous.diceUsed + proj1.diceDelta,
          bonusRoll,
          hand: drawn ? [...hand1, drawn.id] : hand1,
          deckAvailable: mask || FULL_DECK,
        };
        if (intermediate && !same(core(intermediate), { ...core(midState), hand: classes(midState.hand) })) continue;
        for (const candidate of reconcileState(midState, observed)) {
          candidate.reset ||= !mask;
          add(candidate);
          // 一旦可能存在两种不同的剩余牌库，更多路径就无法
          // 把结果重新变回明确的恢复。
          if (unique.size > 1) return [...unique.values()];
        }
      }
    }
  }
  return [...unique.values()];
}

// 按状态探索未观测到的动作，而不是用任意的两动作截断。
// 因预算耗尽而停止视为未解决，即使目前已经找到一个匹配状态。
export function createRecoverySearch(previous, observed, { firstActions = null, firstBonusRoll = null, checkpoints = [], maxStates = 4096 } = {}) {
  const cardReachable = cardReachability();
  const inventoryReachable = handInventoryReachability();
  function* paths() {
    const queue = [{ state: previous, reset: false, checkpoint: 0 }], seen = new Set(), matches = new Map();
    const signature = state => keyOf({ ...state, hand: classes(state.hand) }) + ":" + deckSignature(state.deckAvailable);
    let nodes = 0;
    if (observed.diceUsed < previous.diceUsed) return { resolved: [], exhausted: true, nodes };
    seen.add("0:" + signature(previous));
    for (let head = 0; head < queue.length; head++) {
      const item = queue[head], state = item.state;
      const required = checkpoints[item.checkpoint] ?? observed;
      if (state.diceUsed >= 100 && !state.bonusRoll) continue;
      if (!handReachable(state, required)) continue;
      if (!inventoryReachable(state, required)) continue;
      for (let action = 0; action <= state.hand.length; action++) {
        if (head === 0 && firstActions && !firstActions.includes(action)) continue;
        if ((!action || cards[state.hand[action - 1]].type === 2) && remainingRolls(state, required) === 0) continue;
        // 被剪枝的分支也会 yield，这样大量路径被拒绝时，名义上增量的
        // 搜索也不会变成一个冗长的同步任务。
        yield;
        const projection = project(state, action);
        if (state.diceUsed + projection.diceDelta > required.diceUsed) continue;
        for (const outcome of projection.outcomes) {
          const hand = [...state.hand];
          if (action) hand.splice(action - 1, 1);
          const draw = tiles[outcome.score - 1].event === 2 && hand.length < 5;
          const nextCore = { position: outcome.score, diceUsed: state.diceUsed + projection.diceDelta,
            hand: { length: hand.length + Number(draw) } };
          const bonuses = bonusOutcomes(state, projection, outcome).filter(bonusRoll =>
            (head !== 0 || typeof firstBonusRoll !== "boolean" || bonusRoll === firstBonusRoll) &&
            handReachable({ ...nextCore, bonusRoll }, required));
          if (!bonuses.length) continue;
          if (bonuses.every(bonusRoll => remainingRolls({ ...nextCore, bonusRoll }, required) === 0) &&
              nextCore.hand.length === required.hand.length && !cardReachable(nextCore.position, required.position)) continue;
          const draws = draw ? cards.slice(1).filter(card => state.deckAvailable & (1 << (card.id - 1)))
            .filter((card, i, all) => all.findIndex(other => cardClass(other.id) === cardClass(card.id)) === i) : [null];
          for (const card of draws) for (const bonusRoll of bonuses) {
            nodes++;
            const mask = card ? state.deckAvailable & ~(1 << (card.id - 1)) : state.deckAvailable;
            const next = { ...state, position: outcome.score, diceUsed: state.diceUsed + projection.diceDelta,
              bonusRoll, hand: card ? [...hand, card.id] : hand, deckAvailable: mask || FULL_DECK };
            if (!inventoryReachable(next, required)) { yield; continue; }
            let checkpoint = item.checkpoint;
            if (checkpoint < checkpoints.length && same(core(required), { ...core(next), hand: classes(next.hand) })) checkpoint++;
            const reset = item.reset || !mask, key = checkpoint + ":" + signature(next);
            if (checkpoint === checkpoints.length && same(core(observed), { ...core(next), hand: classes(next.hand) })) {
              matches.set(key, { state: next, reset, action: { kind: action === 0 ? "roll" : cards[state.hand[action - 1]].type === 2 ? "multiplier" : "card", slot: action, sums: outcome.sums } });
              if (matches.size > 1) return { resolved: [...matches.values()], exhausted: true, nodes };
            }
            const nextRequired = checkpoints[checkpoint] ?? observed;
            // 非奖励状态若不再次付费掷骰，就无法重新获得奖励。
            const possible = !(next.diceUsed === nextRequired.diceUsed && nextRequired.bonusRoll && !next.bonusRoll);
            if (possible && !seen.has(key)) {
              if (seen.size >= maxStates) return { resolved: [], exhausted: false, nodes };
              seen.add(key); queue.push({ state: next, reset, checkpoint });
            }
            yield;
          }
        }
      }
    }
    return { resolved: [...matches.values()], exhausted: true, nodes };
  }
  const iterator = paths();
  let result = null;
  return { advance({ maxMs = 6, maxNodes = 2048 } = {}) {
    if (result) return result;
    const started = performance.now();
    for (let nodes = 0; nodes < maxNodes && performance.now() - started < maxMs; nodes++) {
      const next = iterator.next();
      if (next.done) return result = next.value;
    }
    return { resolved: [], exhausted: false, pending: true };
  } };
}
export function exploreTransition(previous, observed, options = {}) {
  const result = createRecoverySearch(previous, observed, options).advance(options);
  return Object.assign(result.resolved, { exhausted: result.exhausted });
}

const completeCore = observed => observed?.visible && Number.isInteger(observed.position) && observed.position >= 1 && observed.position <= 2898
  && Number.isInteger(observed.diceUsed) && observed.diceUsed >= 0 && observed.diceUsed <= 100
  && typeof observed.bonusRoll === "boolean" && Array.isArray(observed.hand)
  && observed.hand.length <= 5 && observed.hand.every(id => cards[id] && cardClass(id) === id);

function startedActions(previous, observed) {
  if (observed.position !== previous.position ||
      same(core(observed), { ...core(previous), hand: classes(previous.hand) })) return [];
  const actions = [];
  for (let action = 0; action <= previous.hand.length; action++) {
    const projection = project(previous, action), hand = [...previous.hand];
    if (observed.diceUsed !== previous.diceUsed + projection.diceDelta) continue;
    if (!projection.random && observed.bonusRoll !== previous.bonusRoll) continue;
    if (action) hand.splice(action - 1, 1);
    if (same(observed.hand, classes(hand)) && projection.outcomes.some(outcome =>
      outcome.score !== previous.position || outcome.raw !== previous.position)) actions.push(action);
  }
  return actions;
}

function actionStartsHere(previous, observed) {
  return startedActions(previous, observed).length > 0;
}

export class AssistTracker {
  constructor() { this.reset(); }
  reset() {
    this.state = null;
    this.lastObservation = null;
    this.pendingKey = null;
    this.pendingSince = 0;
    this.pendingCount = 0;
    this.lastAt = -Infinity;
    this.manual = null;
    this.reconciliation = null;
    this.characterAnchor = null;
    this.movingKey = null;
    this.motion = null;
    this.observations = [];
    this.stateAt = -Infinity;
    this.actionHint = null;
    this.lost = false;
    this.profileId = null;
    this.verifications = 0; this.lastMismatch = null;
    this.requireDeck("initial");
  }
  requireDeck(reason = "manual") {
    this.deckReason = reason;
    this.verified = false;
    this.scanKey = null;
    this.votes = Array.from({ length: 30 }, () => ({ value: null, count: 0, at: -Infinity, frame: null }));
  }
  correct(values, at) {
    if (!this.lastObservation?.visible) return false;
    this.manual = { key: keyOf(this.lastObservation), values, expires: at + 15000 };
    this.pendingKey = null;
    return true;
  }
  get seen() { return this.votes.filter(vote => vote.count >= 2).length; }
  record(observation, at) {
    if (!Number.isFinite(at) || at < (this.observations.at(-1)?.at ?? at) - 120000) return;
    const row = { at, observation: completeCore(observation) ? { visible: true, ...core(observation),
      hand: [...observation.hand], overlay: !!observation.overlay, dimmed: !!observation.dimmed,
      illumination: observation.illumination ?? 1 } : { visible: false, partial: observation?.visible === true } };
    const index = this.observations.findIndex(record => record.at >= at);
    if (index < 0) this.observations.push(row);
    else if (this.observations[index].at === at) {
      if (row.observation.visible || !this.observations[index].observation.visible) this.observations[index] = row;
    }
    else this.observations.splice(index, 0, row);
    const newest = this.observations.at(-1).at;
    while (this.observations.length > 1200 || newest - this.observations[0].at > 120000) this.observations.shift();
    // 在延迟重读历史后重新计算。单个盲样本不构成发生另一次动作的
    // 证据；只有持续的空档才启用空档恢复。
    this.lost = !!this.state && hasObservationGap(this.observations, this.stateAt);
  }
  intermediate(observed, at) {
    let group = null, hint = null, start = null, unconfirmed = false;
    const checkpoints = [];
    let anchor = this.state;
    const current = keyOf(observed);
    const consider = () => {
      if (!group || group.key === current) return;
      if (group.observation.position === anchor.position) {
        // 强识别的骰子弹窗可以提供一个起始样本；最终帧会
        // 独立确认其计数器和剩余手牌。
        if ((group.count < 2 || group.last - group.first < 50) && !group.observation.overlay) return;
        if (anchor === this.state && group.key !== keyOf({ ...core(this.state), hand: classes(this.state.hand) })) {
          const actions = startedActions(this.state, group.observation);
          if (actions.length && !hint) { hint = actions; start = group.observation; }
        }
        return;
      }
      // 真实的外来分数样本不能仅因为它持续时间太短、未能成为确认
      // 检查点就被忽略。当前目的地上的手牌奖励帧是抵达证据，
      // 不是额外移动。
      if (group.observation.position === observed.position && group.observation.diceUsed === observed.diceUsed) return;
      if (group.count < 2 || group.last - group.first < 50) { unconfirmed = true; return; }
      const candidates = reconcileState(anchor, group.observation);
      if (candidates.length === 1) {
        checkpoints.push({ ...group.observation, at: group.last });
        anchor = candidates[0].state;
      } else unconfirmed = true;
    };
    for (const record of this.observations) {
      if (record.at <= this.stateAt || record.at > at) continue;
      if (!record.observation.visible) { consider(); group = null; continue; }
      const key = keyOf(record.observation);
      if (key !== group?.key) { consider(); group = { key, observation: record.observation, first: record.at, last: record.at, count: 1 }; }
      else { group.last = record.at; group.count++; }
    }
    consider(); return { intermediate: checkpoints.at(-1) ?? null, checkpoints, hint, start, unconfirmed };
  }
  accepted(at) { this.stateAt = at; this.actionHint = null; this.lost = false; this.motion = null; }
  rememberCharacter(observed) {
    if (this.characterAnchor?.position !== this.state.position) this.characterAnchor = null;
    if (observed.character?.present && !observed.deck?.open)
      this.characterAnchor = { position: this.state.position, id: observed.character.id };
  }
  result(issue, extra = {}) {
    return { ready: !issue, issue, seen: this.seen, verification: this.deckReason,
      canCorrect: !!this.lastObservation?.visible, ...extra };
  }
  collectDeck(observed, key, at, sourceFrame) {
    if (this.scanKey !== key) {
      this.scanKey = key;
      this.votes = Array.from({ length: 30 }, () => ({ value: null, count: 0, at: -Infinity, frame: null }));
    }
    for (const row of observed.deck?.rows || []) {
      const vote = this.votes[row.index];
      if (!vote || typeof row.obtained !== "boolean") continue;
      if (at <= vote.at || sourceFrame === vote.frame || at - vote.at < 40) continue;
      if (vote.value !== row.obtained) { vote.value = row.obtained; vote.count = 1; }
      else vote.count++;
      vote.at = at; vote.frame = sourceFrame;
    }
  }
  deckIssue(deck) {
    if (!deck?.open) return "deck-open";
    const rows = deck.rows || [];
    const range = deck.range || (rows.length ? {
      start: Math.min(...rows.map(row => row.index)), end: Math.max(...rows.map(row => row.index)),
    } : null);
    if (!range) return "deck-scan";

    const missingBelow = this.votes.some((vote, i) => i > range.end && vote.count < 2);
    const missingAbove = this.votes.some((vote, i) => i < range.start && vote.count < 2);

    // 在提示用户滚离当前屏幕上的那些行之前，
    // 先等待它们的第二个新鲜样本。
    if (this.votes.some((vote, i) => i >= range.start && i <= range.end && vote.count === 1)) return "deck-scan";

    if (missingBelow && range.start <= 2) return "deck-down";
    if (missingAbove && range.end >= 27) return "deck-up";
    if (missingBelow && !missingAbove) return "deck-down";
    if (missingAbove && !missingBelow) return "deck-up";

    const missing = this.votes.findIndex(vote => vote.count < 2);
    if (missing < 0) return null;
    if (missing < range.start) return range.start === 0 ? "deck-down" : "deck-up";
    if (missing > range.end) return "deck-down";
    if (missingBelow) return "deck-down";
    if (missingAbove) return "deck-up";
    return "deck-adjust";
  }
  update(observation, at, { sourceFrame = at } = {}) {
    if (!Number.isFinite(at) || at <= this.lastAt) return this.result("waiting");
    this.record(observation, at);
    // 延迟/丢失的帧不能证明已知牌库发生了变化。
    // 先尝试观测到的最终状态；只有无法解释的变化才需要扫描。
    if (at - this.lastAt > 3500) { this.pendingKey = null; this.movingKey = null; }
    this.lastAt = at;
    this.lastObservation = observation;
    if (!observation.visible) {
      this.pendingKey = null;
      this.manual = null;
      return this.result(observation.issue || "window");
    }
    const rawKey = keyOf(observation);
    if (this.manual && (this.manual.key !== rawKey || at > this.manual.expires)) this.manual = null;
    const observed = this.manual ? { ...observation, ...this.manual.values } : observation;
    const complete = completeCore(observed);
    if (!complete) {
      this.pendingKey = null;
      return this.result(observed.position === null ? "score" : observed.diceUsed === null ? "dice" : observed.hand === null ? "hand" : "bonus");
    }
    const key = keyOf(observed);
    if (observed.character?.present) this.movingKey = null;
    if (observed.profile?.present) this.profileId = observed.profile.id;
    if (this.verified && observed.character?.present === false && observed.character.score <= .26) {
      const actions = startedActions(this.state, observed);
      if (actions.length && !this.actionHint) this.actionHint = actions;
    }
    if (this.verified && !this.actionHint && observed.position === this.state.position) {
      const actions = startedActions(this.state, observed);
      if (actions.length && !reconcileState(this.state, observed).length) this.actionHint = actions;
    }
    if (this.movingKey && this.movingKey !== key) this.movingKey = null;
    if (key !== this.pendingKey) { this.pendingKey = key; this.pendingSince = at; this.pendingCount = 1; }
    else this.pendingCount++;
    if (!this.verified) this.collectDeck(observed, key, at, sourceFrame);
    const unchanged = this.verified && same(core(observed), { ...core(this.state), hand: classes(this.state.hand) });
    // 分数未变但骰子/卡牌已消耗，是动作前奏，包括棋盘被其他窗口
    // 遮住的情况。仅凭一个合法的两动作解释不能把它变成已抵达状态。
    // 观测到的离场与回归允许真正的同格返回；无任何可能移动的
    // 被钳制动作则绕过该检查。
    const absent = observed.character?.present === false && Number.isFinite(observed.character.score) &&
      observed.character.score <= .26;
    const unknown = !observed.character || typeof observed.character.present !== "boolean" ||
      observed.character.present === false && !absent;
    const prelude = this.verified && !unchanged && actionStartsHere(this.state, observed);
    if (prelude) {
      if (this.motion?.key !== key) this.motion = { key, departed: 0, returned: 0, at: -Infinity, frame: null };
      if (at - this.motion.at >= 40 && sourceFrame !== this.motion.frame) {
        if (absent) { this.motion.departed++; this.motion.returned = 0; }
        else if (observed.character?.present && this.motion.departed >= 2) this.motion.returned++;
        else if (observed.character?.present) this.motion.departed = 0;
        this.motion.at = at; this.motion.frame = sourceFrame;
      }
    }
    if (this.pendingCount < 2 || at - this.pendingSince < 200) return this.result("settling");
    const fresh = observed.position === 1 && observed.diceUsed === 0 && !observed.bonusRoll && observed.hand.length === 0;
    if (fresh && this.deckReason !== "manual" && (!this.verified || !same(core(observed), core(this.state)))) {
      this.state = { schemaVersion: 1, rulesVersion: RULES_VERSION, ...core(observed), deckAvailable: FULL_DECK };
      this.verified = true;
      this.reconciliation = this.movingKey = null;
      this.accepted(at);
      this.characterAnchor = null;
      this.rememberCharacter(observed);
      return this.result(null, { state: this.state, synchronized: true, deckOpen: !!observed.deck?.open });
    }
    if (!this.verified) {
      if (this.seen < 30) {
        return this.result(this.deckIssue(observed.deck));
      }
      let mask = 0;
      this.votes.forEach((vote, index) => { if (!vote.value) mask |= 1 << index; });
      if (!mask) mask = FULL_DECK;
      this.state = { schemaVersion: 1, rulesVersion: RULES_VERSION, ...core(observed), hand: handIds(observed.hand, mask), deckAvailable: mask };
      this.verified = true; this.verifications++;
      this.reconciliation = this.movingKey = null;
      this.accepted(at);
      this.rememberCharacter(observed);
      return this.result(null, { state: this.state, synchronized: true, deckOpen: !!observed.deck?.open });
    }
    if (prelude && (absent || unknown && !this.manual ||
        observed.character?.present && this.motion.returned < 2 && !this.manual)) {
      this.movingKey = key;
      this.actionHint ||= startedActions(this.state, observed);
      // 未知的角色图元证据既不构成在场，也不构成移动否决。
      // 一个同时也是合法同格返回的核心状态是真正歧义的：
      // 永远不要授权前奏，但也不要在可选探测上无限等待。
      if (!absent && reconcileState(this.state, observed).length && at - this.pendingSince >= 4500) {
        this.requireDeck("gap");
        this.collectDeck(observed, key, at, sourceFrame);
        return this.result(this.deckIssue(observed.deck));
      }
      return this.result("settling", { moving: true });
    }
    if (this.movingKey === key && observed.position === this.state.position && absent)
      return this.result("settling", { moving: true });
    if (unchanged) {
      this.rememberCharacter(observed);
      this.accepted(at);
      return this.result(null, { state: this.state, deckOpen: !!observed.deck?.open });
    }
    const evidence = this.intermediate(observed, at), intermediate = evidence.intermediate;
    this.actionHint ||= evidence.hint;
    const gapAfterCheckpoint = !!intermediate && hasObservationGap(this.observations, intermediate.at, at);
    const evidenceKey = JSON.stringify([evidence.checkpoints, evidence.start, this.actionHint, this.lost, gapAfterCheckpoint, evidence.unconfirmed]);
    if (this.reconciliation?.state !== this.state || this.reconciliation.key !== key || this.reconciliation.evidenceKey !== evidenceKey) {
      const candidates = reconcileState(this.state, observed);
      let anchor = this.state, reset = false;
      // 更晚的可见检查点不能抹除它之前的不确定性。
      // 跨越真实的盲区间时，保留所有兼容的前缀牌库，
      // 改为用有序的正面观测来约束搜索。
      const uncertainPrefix = this.lost || evidence.unconfirmed;
      for (const checkpoint of uncertainPrefix ? [] : evidence.checkpoints) {
        const step = reconcileState(anchor, checkpoint)[0];
        anchor = step.state; reset ||= step.reset;
      }
      // 在普通连续会话中优先寻找兼容的单动作解释，
      // 包括未捕获到动作前奏的短暂动画跳过。
      // 真实的外来状态证据或长时间空档仍会扩大恢复范围。
      const directOnly = !uncertainPrefix && !gapAfterCheckpoint;
      const options = { firstActions: !intermediate || uncertainPrefix ? this.actionHint : null,
        firstBonusRoll: !intermediate || uncertainPrefix ? evidence.start?.bonusRoll : null, directOnly,
        checkpoints: uncertainPrefix ? evidence.checkpoints : [] };
      // 先从单动作候选开始。在受约束的恢复应用边界之前，
      // 不要枚举每一种两动作抽牌组合。
      let resolved = uncertainPrefix && intermediate ? [] :
        resolveTransition(anchor, observed, { ...options, directOnly: true }), search = null;
      if (resolved.length < 2 && (!directOnly || resolved.length === 0)) {
        search = createRecoverySearch(anchor, observed, options);
        resolved = search.advance().resolved;
      }
      for (const candidate of resolved) candidate.reset ||= reset;
      this.reconciliation = { state: this.state, key, candidates, resolved, evidenceKey, search, reset };
    } else if (this.reconciliation.search) {
      const result = this.reconciliation.search.advance();
      this.reconciliation.resolved = result.resolved;
      for (const candidate of result.resolved) candidate.reset ||= this.reconciliation.reset;
      if (!result.pending) this.reconciliation.search = null;
    }
    const { candidates } = this.reconciliation;
    const { resolved } = this.reconciliation;
    if (resolved.length === 1) {
      this.lastMismatch = null;
      const { state, reset, action } = resolved[0];
      this.state = state;
      this.accepted(at);
      this.reconciliation = null;
      this.movingKey = null;
      this.rememberCharacter(observed);
      return this.result(null, { state, action, deckReset: reset });
    }
    const diceDelta = observed.diceUsed - this.state.diceUsed;
    this.lastMismatch = {
      from: core(this.state), to: core(observed),
      directCandidates: candidates.length, multiStepCandidates: resolved.length,
      diceDelta, timeInPending: Math.round(at - this.pendingSince)
    };
    const settlingLimit = diceDelta >= 0 && diceDelta <= 2 ? 4500 : 2500;
    if (at - this.pendingSince < settlingLimit) return this.result("settling");
    this.requireDeck("gap");
    this.collectDeck(observed, key, at, sourceFrame);
    return this.result("deck-open");
  }
}
