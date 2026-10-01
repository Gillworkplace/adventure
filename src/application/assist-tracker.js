import { cards, tiles, FULL_DECK, RULES_VERSION } from "../rules/index.js";
import { project } from "../environment/projection.js";

export const cardClass = id => {
  const card = cards[id];
  return card ? cards.findIndex(other => other?.type === card.type && other.value === card.value) : 0;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const classes = hand => hand.map(cardClass);
const core = observation => ({ position: observation.position, diceUsed: observation.diceUsed, bonusRoll: observation.bonusRoll, hand: observation.hand });
const keyOf = observation => JSON.stringify(core(observation));
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
  return cards.slice(1).filter(card => cardClass(card.id) === card.id).map(card => idsFor(card.id).filter(id => mask & (1 << (id - 1))).length).join(",");
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

// Keep ambiguity visible instead of falling back to a prior accepted state.
export function resolveTransition(previous, observed, { intermediate = null, firstActions = null, directOnly = false } = {}) {
  const direct = intermediate ? [] : reconcileState(previous, observed)
    .filter(candidate => !firstActions || firstActions.includes(candidate.action.slot));
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
          // Once two different remaining decks are possible, more paths cannot
          // turn the result back into an unambiguous recovery.
          if (unique.size > 1) return [...unique.values()];
        }
      }
    }
  }
  return [...unique.values()];
}

const completeCore = observed => observed?.visible && Number.isInteger(observed.position) && observed.position >= 1 && observed.position <= 2898
  && Number.isInteger(observed.diceUsed) && observed.diceUsed >= 0 && observed.diceUsed <= 100
  && typeof observed.bonusRoll === "boolean" && Array.isArray(observed.hand)
  && observed.hand.length <= 5 && observed.hand.every(id => cards[id] && cardClass(id) === id);

function startedActions(previous, observed) {
  if (observed.position !== previous.position) return [];
  const actions = [];
  for (let action = 0; action <= previous.hand.length; action++) {
    const projection = project(previous, action), hand = [...previous.hand];
    if (observed.diceUsed !== previous.diceUsed + projection.diceDelta) continue;
    if (!projection.random && observed.bonusRoll !== previous.bonusRoll) continue;
    if (action) hand.splice(action - 1, 1);
    if (same(observed.hand, classes(hand)) && projection.outcomes.some(outcome => outcome.score !== previous.position)) actions.push(action);
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
    const lastComplete = this.observations.findLast(record => record.at <= at && record.observation.visible);
    if (at > this.stateAt && at - (lastComplete?.at ?? this.stateAt) > 500) this.lost = true;
    const row = { at, observation: completeCore(observation) ? { visible: true, ...core(observation),
      hand: [...observation.hand], overlay: !!observation.overlay } : { visible: false } };
    const index = this.observations.findIndex(record => record.at >= at);
    if (index < 0) this.observations.push(row);
    else if (this.observations[index].at === at) {
      if (row.observation.visible || !this.observations[index].observation.visible) this.observations[index] = row;
    }
    else this.observations.splice(index, 0, row);
    const newest = this.observations.at(-1).at;
    while (this.observations.length > 1200 || newest - this.observations[0].at > 120000) this.observations.shift();
  }
  intermediate(observed, at) {
    let group = null, found = null, hint = null;
    const current = keyOf(observed);
    const consider = () => {
      if (!group || group.key === current) return;
      if (group.observation.position === this.state.position) {
        // A strongly identified dice popup can provide one start sample; the
        // final frame independently confirms its counters and remaining hand.
        if ((group.count < 2 || group.last - group.first < 50) && !group.observation.overlay) return;
        if (group.key !== keyOf({ ...core(this.state), hand: classes(this.state.hand) })) {
          const actions = startedActions(this.state, group.observation);
          if (actions.length && !hint) hint = actions;
        }
        return;
      }
      if (group.count < 2 || group.last - group.first < 50) return;
      if (reconcileState(this.state, group.observation).length) found = group.observation;
    };
    for (const record of this.observations) {
      if (record.at <= this.stateAt || record.at > at) continue;
      if (!record.observation.visible) { consider(); group = null; continue; }
      const key = keyOf(record.observation);
      if (key !== group?.key) { consider(); group = { key, observation: record.observation, first: record.at, last: record.at, count: 1 }; }
      else { group.last = record.at; group.count++; }
    }
    consider(); return { intermediate: found, hint };
  }
  accepted(at) { this.stateAt = at; this.actionHint = null; this.lost = false; }
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

    // Wait for a second fresh sample of the rows currently on screen before
    // telling the user to scroll away from them.
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
    // A delayed/missing frame is not evidence that the known deck changed.
    // Try the observed final state first; only unresolved changes need a scan.
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
    if (this.movingKey && this.movingKey !== key) this.movingKey = null;
    if (key !== this.pendingKey) { this.pendingKey = key; this.pendingSince = at; this.pendingCount = 1; }
    else this.pendingCount++;
    if (!this.verified) this.collectDeck(observed, key, at, sourceFrame);
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
    const unchanged = same(core(observed), { ...core(this.state), hand: classes(this.state.hand) });
    // Old score with consumed dice/cards is an action prelude, including when
    // another window hides the board. A legal two-action explanation alone
    // cannot turn it into an arrived state. Positive presence permits genuine
    // same-square returns; clamped actions with no possible movement bypass it.
    if (!unchanged && actionStartsHere(this.state, observed) && !observed.character?.present) {
      this.movingKey = key;
      return this.result("settling", { moving: true });
    }
    if (this.movingKey === key && observed.position === this.state.position && !observed.character?.present)
      return this.result("settling", { moving: true });
    if (unchanged) {
      this.rememberCharacter(observed);
      this.accepted(at);
      return this.result(null, { state: this.state, deckOpen: !!observed.deck?.open });
    }
    const evidence = this.intermediate(observed, at), intermediate = evidence.intermediate;
    this.actionHint ||= evidence.hint;
    const evidenceKey = JSON.stringify([intermediate, this.actionHint, this.lost]);
    if (this.reconciliation?.state !== this.state || this.reconciliation.key !== key || this.reconciliation.evidenceKey !== evidenceKey) {
      const candidates = reconcileState(this.state, observed);
      const resolved = resolveTransition(this.state, observed, { intermediate,
        firstActions: this.actionHint, directOnly: !intermediate && !this.lost && !!this.actionHint });
      this.reconciliation = { state: this.state, key, candidates, resolved, evidenceKey };
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
