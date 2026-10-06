import { CharacterProbe } from "./character.js";

const WIDTH = 1234;
const CLASSES = [1, 2, 3, 4, 4, 6, 6, 8, 8, 10, 10, 12, 12, 14, 14, 16, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 29];
const white = (r, g, b) => Math.min(r, g, b) > 205 && Math.max(r, g, b) - Math.min(r, g, b) < 48;
const WHITE_POINTS = [[70, 7], [130, 7], [8, 50], [200, 100], [80, 278], [130, 278]];
const CORE_REGIONS = [[74, 55, 51, 21], [420, 638, 220, 42], [16, 540, 176, 70], [128, 659, 35, 27]];

export function findGameRegion({ data, width, height }) {
  const mask = new Uint8Array(width * height), queue = new Int32Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = +white(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  const choices = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    let head = 0, tail = 1, left = width, right = 0, top = height, bottom = 0;
    queue[0] = i; mask[i] = 0;
    while (head < tail) {
      const p = queue[head++], x = p % width, y = (p / width) | 0;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (const n of [x ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
        if (n >= 0 && n < mask.length && mask[n]) { mask[n] = 0; queue[tail++] = n; }
      }
    }
    const w = right - left + 1, h = bottom - top + 1, measured = w / 193;
    if (measured < .55 || measured > 3 || Math.abs(h / measured - 272) > 6 || tail < 750 * measured * measured) continue;
    const rounded = Math.round(measured * 20) / 20;
    const scale = Math.abs(rounded - measured) < .012 ? rounded : measured;
    const x = Math.round(left + (w - 193 * scale) / 2 - 8 * scale), y = Math.round(top + (h - 272 * scale) / 2 - 7 * scale);
    if (x < -2 || y < -2 || x + WIDTH * scale > width + 2 || y + 694 * scale > height + 2) continue;
    choices.push({ x, y, width: WIDTH * scale, height: 694 * scale, scale });
  }
  return choices.sort((a, b) => b.scale - a.scale);
}

function runs(bits) {
  const result = [];
  for (let i = 0; i < bits.length;) {
    if (!bits[i]) { i++; continue; }
    const start = i;
    while (i < bits.length && bits[i]) i++;
    result.push([start, i]);
  }
  return result;
}

export function normalized(mask, width, top, bottom, left, right) {
  const output = new Float32Array(216);
  const w = right - left, h = bottom - top;
  for (let y = 0; y < 18; y++) for (let x = 0; x < 12; x++) {
    const x0 = x * w / 12, x1 = (x + 1) * w / 12, y0 = y * h / 18, y1 = (y + 1) * h / 18;
    let sum = 0;
    for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++)
      for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++)
        sum += mask[(top + yy) * width + left + xx] * (Math.min(x1, xx + 1) - Math.max(x0, xx)) * (Math.min(y1, yy + 1) - Math.max(y0, yy));
    output[y * 12 + x] = sum / ((x1 - x0) * (y1 - y0));
  }
  return output;
}

export class GameRecognizer {
  constructor(templates) {
    this.templates = templates;
    this.rows = templates.rows.map(row => ({ ...row, mask: this.inkMask(row) }));
    this.anchor = { ...templates.anchor, mask: this.inkMask(templates.anchor) };
    this.character = new CharacterProbe(templates.characters);
  }
  inkMask(template) {
    const mask = new Uint8Array(template.width * template.height);
    for (const p of template.ink) mask[p] = 1;
    return mask;
  }
  pixel(x, y) { const i = (Math.round(y) * WIDTH + Math.round(x)) * 4; return this.data.subarray(i, i + 3); }
  whiteAt(x, y) { return white(...this.pixel(x, y)); }
  textMask(x, y, width, height, predicate) {
    const mask = new Uint8Array(width * height);
    for (let yy = 0; yy < height; yy++) for (let xx = 0; xx < width; xx++)
      mask[yy * width + xx] = +predicate(...this.pixel(x + xx, y + yy));
    return mask;
  }
  inkSimilarity(mask, reference) {
    let total = 0, both = 0;
    for (let i = 0; i < mask.length; i++) { total += mask[i] + reference[i]; both += mask[i] & reference[i]; }
    return total ? both * 2 / total : 0;
  }
  anchorScore(image) {
    const mask = new Uint8Array(image.width * image.height);
    for (let i = 0; i < mask.length; i++) mask[i] = +(Math.min(image.data[i * 4], image.data[i * 4 + 1], image.data[i * 4 + 2]) > 170);
    return this.inkSimilarity(mask, this.anchor.mask);
  }
  visible() {
    if (WHITE_POINTS.filter(([x, y]) => this.whiteAt(x, y)).length < 3) return false;
    const a = this.anchor;
    const mask = this.textMask(a.x, a.y, a.width, a.height, (r, g, b) => Math.min(r, g, b) > 170);
    this.lastAnchorScore = this.inkSimilarity(mask, a.mask); return this.lastAnchorScore > .62;
  }
  dimmingGain() {
    const samples = WHITE_POINTS.map(([x, y]) => Array.from(this.pixel(x, y)))
      .filter(rgb => Math.max(...rgb) - Math.min(...rgb) < 30 && Math.min(...rgb) >= 32);
    if (samples.length < 4) return null;
    const levels = samples.map(rgb => Math.max(...rgb)).sort((a, b) => a - b);
    const level = levels[Math.floor(levels.length / 2)], gain = 255 / level;
    // 均匀的变暗层会保留 UI 的颜色与几何结构。不要提亮任意的
    // 被遮挡窗口、彩色覆盖层或接近黑色的 UI。
    if (gain < 1.06 || gain > 7.5 || levels.filter(value => Math.abs(value - level) < Math.max(7, level * .12)).length < 4) return null;
    return gain;
  }
  brightenCore(image, gain, retained) {
    this.corePixels ||= new Uint8ClampedArray(WIDTH * 694 * 4);
    const source = image.data, target = this.corePixels;
    const regions = retained ? CORE_REGIONS : [...CORE_REGIONS,
      [this.anchor.x, this.anchor.y, this.anchor.width, this.anchor.height]];
    for (const [x, y, width, height] of regions) for (let yy = y; yy < y + height; yy++) {
      for (let i = (yy * WIDTH + x) * 4, end = i + width * 4; i < end; i += 4) {
        target[i] = source[i] * gain; target[i + 1] = source[i + 1] * gain;
        target[i + 2] = source[i + 2] * gain; target[i + 3] = source[i + 3];
      }
    }
    if (!retained) for (const [x, y] of WHITE_POINTS) {
      const i = (y * WIDTH + x) * 4;
      for (let channel = 0; channel < 4; channel++) target[i + channel] = channel === 3 ? source[i + channel] : source[i + channel] * gain;
    }
    this.data = target;
  }
  number(kind) {
    const [x, y, w, h] = kind === "score" ? [74, 55, 51, 21] : [131, 662, 28, 21];
    const mask = this.textMask(x, y, w, h, kind === "score" ? (r, g, b) => Math.min(r, g, b) > 135 : (r, g, b) => b > 165 && g > 130 && r > 95);
    const columns = Array.from({ length: w }, (_, x) => { for (let y = 0; y < h; y++) if (mask[y * w + x]) return true; return false; });
    const parts = runs(columns);
    if (!parts.length || parts.length > (kind === "score" ? 4 : 3)) return null;
    let text = "";
    for (const [left, right] of parts) {
      let top = h, bottom = 0;
      for (let yy = 0; yy < h; yy++) for (let xx = left; xx < right; xx++) if (mask[yy * w + xx]) { top = Math.min(top, yy); bottom = Math.max(bottom, yy + 1); }
      if (bottom - top < 7 || bottom - top > 14 || right - left > 9) return null;
      const feature = normalized(mask, w, top, bottom, left, right), scores = new Map();
      for (const template of this.templates.digits[kind]) {
        let error = 0;
        for (let i = 0; i < feature.length; i++) error += Math.abs(feature[i] - template.pixels[i] / 255);
        error = error / feature.length + Math.abs((right - left) / (bottom - top) - template.width / template.height) * .3;
        scores.set(template.value, Math.min(scores.get(template.value) ?? Infinity, error));
      }
      const sorted = [...scores].sort((a, b) => a[1] - b[1]);
      if (sorted[0][1] > .19 || sorted[1][1] - sorted[0][1] < .018) return null;
      text += sorted[0][0];
    }
    if (text.length > 1 && text.startsWith("0")) return null;
    const value = Number(text);
    return value >= (kind === "score" ? 1 : 0) && value <= (kind === "score" ? 2898 : 100) ? value : null;
  }
  hand() {
    const result = [];
    let empty = false;
    for (let slot = 0; slot < 5; slot++) {
      const x = 422 + slot * 42.67, y = 643;
      let teal = 0;
      for (let yy = 5; yy < 29; yy += 3) for (let xx = 5; xx < 29; xx += 3) {
        const [r, g, b] = this.pixel(x + xx, y + yy);
        if (g > r * 1.2 && b > r * 1.25 && Math.abs(g - b) < 80) teal++;
      }
      if (teal > 56) { empty = true; continue; }
      if (empty) return null;
      const costs = [];
      for (const card of this.templates.cards) {
        let best = Infinity;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          let error = 0, count = 0, i = 0;
          for (let yy = 3; yy < 31; yy += 2) for (let xx = 3; xx < 31; xx += 2, i++) {
            if (!card.mask[i]) continue;
            const rgb = this.pixel(x + xx + dx, y + yy + dy);
            for (let channel = 0; channel < 3; channel++) error += Math.abs(rgb[channel] - card.pixels[i * 3 + channel]);
            count += 3;
          }
          best = Math.min(best, error / count / 255);
        }
        costs.push([card.id, best]);
      }
      costs.sort((a, b) => a[1] - b[1]);
      if (costs[0][1] > .20 || costs[1][1] - costs[0][1] < .003) return null;
      result.push(costs[0][0]);
    }
    return result;
  }
  deck() {
    const blank = [[465, 105], [465, 250], [465, 490]].filter(([x, y]) => this.whiteAt(x, y)).length;
    const [r, g, b] = this.pixel(465, 30);
    if (blank < 3 || r < g * 1.25 || r < b * 1.1) { this.deckCache = null; return { open: false, rows: [] }; }
    const mask = this.textMask(256, 67, 221, 544, (r, g, b) => Math.max(r, g, b) < 115);
    // 只有当所有标签像素都未变化时才复用行的身份。复选框像素
    // 在此掩码之外，始终从新帧中采样。
    if (this.deckCache && mask.every((value, i) => value === this.deckCache.mask[i])) {
      return { open: true, range: this.deckCache.range,
        rows: this.deckCache.rows.map(row => ({ index: row.index, identified: true, obtained: this.deckFlag(row.y) }))
          .filter(row => row.obtained !== null) };
    }
    this.deckCache = null;
    const lines = Array.from({ length: 544 }, (_, y) => { let n = 0; for (let x = 0; x < 221; x++) n += mask[y * 221 + x]; return n > 4; });
    const bands = runs(lines).filter(([a, b]) => b - a >= 8 && b - a <= 14);
    const observed = [];
    for (const [start, end] of bands) {
      const y = start + 67;
      const costs = [];
      const parts = [-1, 0, 1].map(dy => this.textMask(256, y + dy, 221, 11, (r, g, b) => Math.max(r, g, b) < 115));
      for (const template of this.rows) {
        let best = 0;
        for (const part of parts) best = Math.max(best, this.inkSimilarity(part, template.mask));
        costs.push([template.id, best]);
      }
      costs.sort((a, b) => b[1] - a[1]);
      const id = costs[0][1] > .80 && costs[0][1] - costs[1][1] > .003 ? costs[0][0] : null;
      const obtained = this.deckFlag(y);
      observed.push({ y, id, obtained });
    }
    if (observed.length < 3) return { open: true, rows: [] };
    const candidates = [];
    for (let start = 0; start < 30; start++) {
      let matches = 0, mismatches = 0;
      for (const row of observed) {
        const index = start + Math.round((row.y - observed[0].y) / 30);
        if (index >= 30) { mismatches += 2; continue; }
        if (row.id !== null) { if (CLASSES[index] === row.id) matches++; else mismatches++; }
      }
      candidates.push({ start, matches, mismatches, score: matches - 3 * mismatches });
    }
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (best.matches < 3 || best.mismatches || best.score - candidates[1].score < 2) return { open: true, rows: [] };
    // 悬停/高亮颜色可能遮住某一行的黑色标签。当六个及以上标签
    // 确立了唯一网格时，该行的物理序号仍然是已知的。
    const trustedGrid = best.matches >= 6 && best.score - candidates[1].score >= 3;
    const identified = row => row.id !== null || trustedGrid
      && Math.abs((row.y - observed[0].y) / 30 - Math.round((row.y - observed[0].y) / 30)) <= 1 / 30;
    this.deckCache = { mask,
      range: { start: best.start, end: best.start + Math.round((observed.at(-1).y - observed[0].y) / 30) },
      rows: observed.filter(identified).map(row => ({ y: row.y,
        index: best.start + Math.round((row.y - observed[0].y) / 30) })).filter(row => row.index < 30) };
    return { open: true,
      range: { start: best.start, end: best.start + Math.round((observed.at(-1).y - observed[0].y) / 30) },
      rows: observed.map(row => ({ index: best.start + Math.round((row.y - observed[0].y) / 30), obtained: row.obtained, identified: identified(row) })).filter(row => row.index < 30 && row.identified && row.obtained !== null) };
  }
  deckFlag(y) {
    let orange = 0, dark = 0;
    for (let yy = y - 3; yy < y + 12; yy++) for (let xx = 232; xx < 252; xx++) {
      const [r, g, b] = this.pixel(xx, yy);
      if (r > 170 && g > 95 && g < 215 && b < g * .8) orange++;
      if (xx >= 242 && xx < 248 && yy >= y + 2 && yy < y + 8 && Math.max(r, g, b) < 100) dark++;
    }
    return orange >= 12 ? true : orange < 3 && dark >= 15 ? false : null;
  }
  readCore(image, { allowOverlay = false, retained = false, illumination = 1 } = {}) {
    this.data = image.data;
    this.lastAnchorScore = 0;
    let overlay = false, dimmed = false;
    if (retained && Number.isFinite(illumination) && illumination >= 1.06 && illumination <= 7.5) {
      this.brightenCore(image, illumination, true); dimmed = true;
    }
    const visible = retained || this.visible();
    if (!retained && visible) {
      // 轻微的淡出可能在已经开始改变卡牌颜色的同时仍通过白像素
      // 门限。也把均匀的淡出归一化，并采用同样更严格的 UI 检查。
      const gain = this.dimmingGain(), score = this.lastAnchorScore;
      if (gain) {
        this.brightenCore(image, gain, false);
        if (this.visible() && this.lastAnchorScore > .80) { illumination = gain; dimmed = true; }
        else { this.data = image.data; this.lastAnchorScore = score; }
      }
    }
    if (!retained && !visible) {
      const a = this.anchor;
      if (allowOverlay) {
        this.lastAnchorScore = this.inkSimilarity(this.textMask(a.x, a.y, a.width, a.height, (r,g,b) => Math.min(r,g,b)>170), a.mask);
        overlay = this.lastAnchorScore > .80;
      }
      if (!overlay) {
        const gain = this.dimmingGain();
        if (gain) {
          this.brightenCore(image, gain, false);
          if (this.visible() && this.lastAnchorScore > .80) { illumination = gain; dimmed = true; }
        }
        if (!dimmed) {
          this.data = image.data;
          return { visible: false, issue: "covered", anchorScore: Math.round((this.lastAnchorScore || 0) * 1000) / 1000 };
        }
      }
    }
    const position = this.number("score"), diceUsed = this.number("dice"), hand = this.hand();
    let blue = 0, yellow = 0, magenta = 0;
    for (let y = 544; y < 607; y += 7) {
      for (const x of [22, 28, 180, 186]) {
        const [r, g, b] = this.pixel(x, y);
        if ((b > r * 1.2 && b > 115) || (g > r * 1.25 && b > r * 1.1)) blue++;
        if (r > b * 1.4 && g > b * 1.05 && r > 175) yellow++;
      }
    }
    for (let y = 566; y <= 586; y += 5) {
      for (let x = 55; x <= 95; x += 8) {
        const [r, g, b] = this.pixel(x, y);
        if (r > 180 && b > 150 && g < 130) magenta++;
      }
    }
    const bonusRoll = (magenta >= 2 || blue > yellow + 5) ? true : (yellow > blue + 5) ? false : null;
    return { visible: true, position, diceUsed, hand, bonusRoll, overlay, dimmed, illumination: dimmed ? illumination : 1,
      issue: position === null ? "score" : diceUsed === null ? "dice" : hand === null ? "hand" : bonusRoll === null ? "bonus" : null,
      anchorScore: Math.round(this.lastAnchorScore * 1000) / 1000 };
  }
  read(image, context) {
    const observation = this.readCore(image);
    if (!observation.visible) return observation;
    // 变暗校正仅限核心 ROI。牌库标记仍使用原始像素；
    // 模态框后面的可选头像证据不可用。
    this.data = image.data;
    const deck = this.deck();
    let profile = null, character = null, helperIssue = null;
    try {
      profile = observation.dimmed ? null : this.character.profile(this.data);
      if (profile?.present) this.character.profileId = profile.id;
      const knownId = profile?.present ? profile.id : context?.characterId;
      character = !observation.dimmed && !deck.open && observation.position && (knownId || context?.position === observation.position)
        ? this.character.read(this.data, observation.position, knownId, !!profile?.present) : null;
    } catch {
      // 可选的精灵图证据绝不能使有效的核心/牌库读数作废。
      helperIssue = "character";
      profile = character = null;
    }
    return { ...observation, deck, character, profile, helperIssue };
  }
}

// 国服（大冒险）识别器：左上面板为基准窗口，读取位置胶囊
// “N 格”与底栏“本局已投掷次数 N/100”的数字。
// 模板匹配之外叠加拓扑圈数门禁（数字的封闭圈数是物理特征），
// 用于拦截模板分数接近导致的 3↔8、0↔8 类混淆。
const CN_HOLE_LIMITS = { 0: [0, 1], 1: [0, 0], 2: [0, 0], 3: [0, 0], 4: [0, 1], 5: [0, 0], 6: [0, 1], 7: [0, 0], 8: [0, 2], 9: [0, 1] };
export class CnGameRecognizer {
  constructor(templates) {
    this.layout = "cn";
    this.alignRange = 8;
    this.templates = templates;
    this.anchor = { ...templates.anchor, mask: this.inkMask(templates.anchor) };
    this.pill = templates.pill;
    this.dice = templates.dice;
    this.itemBar = templates.itemBar;
    this.itemTemplates = templates.items ?? [];
    this.chargesWindow = templates.charges;
    this.digits = templates.digits.position;
    this.bounds = templates.bounds;
  }
  inkMask(template) {
    const mask = new Uint8Array(template.width * template.height);
    for (const p of template.ink) mask[p] = 1;
    return mask;
  }
  pixel(x, y) { const i = (Math.round(y) * WIDTH + Math.round(x)) * 4; return this.data.subarray(i, i + 3); }
  whiteAt(x, y) { return white(...this.pixel(x, y)); }
  textMask(x, y, width, height, predicate) {
    const mask = new Uint8Array(width * height);
    for (let yy = 0; yy < height; yy++) for (let xx = 0; xx < width; xx++)
      mask[yy * width + xx] = +predicate(...this.pixel(x + xx, y + yy));
    return mask;
  }
  inkSimilarity(mask, reference) {
    let total = 0, both = 0;
    for (let i = 0; i < mask.length; i++) { total += mask[i] + reference[i]; both += mask[i] & reference[i]; }
    return total ? both * 2 / total : 0;
  }
  anchorScore(image) {
    const mask = new Uint8Array(image.width * image.height);
    for (let i = 0; i < mask.length; i++) mask[i] = +(Math.min(image.data[i * 4], image.data[i * 4 + 1], image.data[i * 4 + 2]) > 170);
    return this.inkSimilarity(mask, this.anchor.mask);
  }
  visible() {
    // 面板内容相对面板边框存在几像素的整体漂移，边框白点并不可靠；
    // 可见性完全由锚点（按钮行白字）决定，worker 的对齐阶段已先做过
    // 同一校验。
    const a = this.anchor;
    const mask = this.textMask(a.x, a.y, a.width, a.height, (r, g, b) => Math.min(r, g, b) > 170);
    this.lastAnchorScore = this.inkSimilarity(mask, a.mask);
    return this.lastAnchorScore > .62;
  }
  // 拓扑圈数：字形紧包围盒内被墨迹完全包住的背景连通块数。
  // 数字的圈数是物理特征：8=2、0/6/9=1、其余=0。笔画断裂只会
  // 让圈数变少，不会变多——检测到的圈数超过该数字的上限即可
  // 确凿否决（例如“8”至少要 1 圈，敞口的 3 冒充不了 8）。
  holes(mask, width, glyph) {
    const gw = glyph.right - glyph.left + 1, gh = glyph.bottom - glyph.top;
    const grid = [];
    for (let yy = -1; yy <= gh; yy++) {
      const row = [0];
      for (let xx = 0; xx < gw; xx++) row.push(yy < 0 || yy >= gh ? 0 : (mask[(glyph.top + yy) * width + glyph.left + xx] ? 1 : 0));
      row.push(0);
      grid.push(row);
    }
    const total = grid.length, span = grid[0].length;
    const seen = Array.from({ length: total }, () => new Uint8Array(span));
    let holes = 0;
    for (let yy = 0; yy < total; yy++) for (let xx = 0; xx < span; xx++) {
      if (grid[yy][xx] || seen[yy][xx]) continue;
      const stack = [[xx, yy]];
      seen[yy][xx] = 1;
      let open = false;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        if (cx === 0 || cy === 0 || cx === span - 1 || cy === total - 1) open = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= span || ny >= total || grid[ny][nx] || seen[ny][nx]) continue;
          seen[ny][nx] = 1;
          stack.push([nx, ny]);
        }
      }
      if (!open) holes++;
    }
    return holes;
  }
  // 窗口内数字串读取：列游程 → 底部墨迹段 → 模板匹配 + 拓扑圈数
  // 门禁，任一字形无把握即整体作废（宁缺毋滥）。
  // 有 2 倍细节图（detailData，2468×1388）时在细节空间读取：胶囊
  // 数字在 canonical 尺度只有 8 像素高，5/6、0/8 一类的判别差异只有
  // 2-3 像素；细节空间采样到 16 像素高，笔画与封闭圈都是真实信息
  // 增益（模板也按细节尺度提取）。
  matchGlyphs(window, threshold, maxGlyphHeight) {
    const scale = this.detailData ? 2 : 1;
    const data = this.detailData ?? this.data;
    const stride = 1234 * scale;
    const x = window.x * scale, y = window.y * scale;
    const width = window.width * scale, height = window.height * scale;
    const mask = new Uint8Array(width * height);
    for (let yy = 0; yy < height; yy++) for (let xx = 0; xx < width; xx++) {
      const i = ((y + yy) * stride + x + xx) * 4;
      mask[yy * width + xx] = +(Math.min(data[i], data[i + 1], data[i + 2]) > threshold);
    }
    const columns = Array.from({ length: width }, (_, xx) => { for (let yy = 0; yy < height; yy++) if (mask[yy * width + xx]) return true; return false; });
    // 笔画很细，任何有墨迹的列都算；相邻数字只隔 1-2 列，不做游程
    // 合并，否则相邻数字会被粘成一个超宽块。
    const parts = [];
    let start = -1;
    for (let xx = 0; xx <= columns.length; xx++) {
      const ink = xx < columns.length && columns[xx];
      if (ink && start < 0) start = xx;
      else if (!ink && start >= 0) {
        if (xx - 1 - start >= scale) parts.push([start, xx - 1]);
        start = -1;
      }
    }
    if (!parts.length) return null;
    const glyphs = [];
    let text = "";
    for (const [rawLeft, rawRight] of parts) {
      const rows = Array.from({ length: height }, (_, yy) => { for (let xx = rawLeft; xx <= rawRight; xx++) if (mask[yy * width + xx]) return true; return false; });
      // 胶囊上沿的装饰竖线会把包围盒撑高：从最底部的墨迹行向上走，
      // 容忍字形内部 1-2 行的断笔，遇到 3 行以上的空档才视为装饰线。
      let bottom = rows.lastIndexOf(true);
      if (bottom < 0) continue;
      bottom += 1;
      let top = bottom - 1, gap = 0;
      for (let yy = bottom - 2; yy >= 0; yy--) {
        if (rows[yy]) { top = yy; gap = 0; }
        else if (++gap > 2 * scale) break;
      }
      // 段内重新收紧左右边界（剔除与数字粘连的噪声空列）。
      let left = rawRight, right = rawLeft;
      for (let xx = rawLeft; xx <= rawRight; xx++) for (let yy = top; yy < bottom; yy++)
        if (mask[yy * width + xx]) { left = Math.min(left, xx); right = Math.max(right, xx); }
      if (right - left + 1 < 2 * scale || right - left + 1 > 8 * scale ||
          bottom - top < 5 * scale || bottom - top > maxGlyphHeight * scale) continue;
      const glyph = { left, right, top, bottom };
      const feature = normalized(mask, width, top, bottom, left, right + 1), scores = new Map();
      for (const template of this.digits) {
        let error = 0;
        for (let i = 0; i < feature.length; i++) error += Math.abs(feature[i] - template.pixels[i] / 255);
        error = error / feature.length + Math.abs((right - left + 1) / (bottom - top) - template.width / template.height) * .3;
        scores.set(template.value, Math.min(scores.get(template.value) ?? Infinity, error));
      }
      // 拓扑门禁：圈数超标的候选直接出局，接受阈值与歧义余量只在
      // 过关候选之间计算。
      const holeCount = this.holes(mask, width, glyph);
      const allowed = [...scores]
        .filter(([value]) => CN_HOLE_LIMITS[value][0] <= holeCount && holeCount <= CN_HOLE_LIMITS[value][1])
        .sort((a, b) => a[1] - b[1]);
      if (!allowed.length || allowed[0][1] > .19) return null;
      if (allowed[1] && allowed[1][1] - allowed[0][1] < .018) return null;
      text += allowed[0][0];
      glyphs.push(glyph);
    }
    if (!text) return null;
    if (text.length > 1 && text.startsWith("0")) return null;
    return { text, glyphs, scale };
  }
  number() {
    const core = this.matchGlyphs(this.pill, 135, 12);
    if (!core) return null;
    let text = core.text;
    // 隐藏首位：个别分辨率下最左边的前导数字渲染得比其余位暗
    // （阈值 135 抓不到）。核心读数最左字形左侧若有空间，就用
    // 更低阈值在“核心字形左边界 - 2”为止的窄带里补读一位，
    // 阈值降档带来的光晕粘连被右边界截断挡住。
    const coreLeft = core.glyphs[0].left / core.scale + this.pill.x;
    if (core.glyphs.length >= 2 && coreLeft >= this.pill.x + 8) {
      const lead = this.matchGlyphs({ ...this.pill, width: coreLeft - 2 - this.pill.x }, 100, 12);
      if (lead && lead.text.length === 1) text = lead.text + text;
    }
    const value = Number(text);
    return value >= this.bounds.positionMin && value <= this.bounds.positionMax ? value : null;
  }
  // 底栏“本局已投掷次数 N/100”的 N：与韩服 diceUsed 同语义。
  // 该值以更暗的灰阶渲染，阈值放宽到 100；窗口内右侧的斜杠
  // （高 11-12 canonical）由高度上限 9 排除。
  diceNumber() {
    if (!this.dice) return null;
    const read = this.matchGlyphs(this.dice, 100, 9);
    const value = read === null ? null : Number(read.text);
    return value !== null && value >= 0 && value <= 100 ? value : null;
  }
  // 底部中央道具栏（5 槽）：按槽内彩色像素判定占用——空槽是暗色
  // 边框，道具图标是有饱和度的彩色立绘。国服道具即卡牌（幸运卡），
  // 与韩服手牌同体系：图标不同渲染但语义相同。身份分两级：
  // ① 结构判别（优先）：NEXT 跳关卡卡 = 顶部横贯的红色横幅
  //   （连续多行宽红区 + 内嵌白字 + 横幅下方红色戛然而止），返回
  //   卡牌 29（引擎中 29/30 行为等价）。数字卡的红色大字下方红色
  //   延续、暗卡的红色竖条宽度不足，均不会误触发。
  // ② 指纹模板：8×12 RGB（同道具跨帧距离 <600，不同道具 >1000），
  //   模板带 card 标注时返回该卡牌 ID，否则返回 "#k" 保持身份
  //   区分（名称待确认）；无模板匹配记 "?"。
  // slots 值约定：null=空槽，number=卡牌 ID，"#k"=指纹身份（未命名），
  // "?"=无法识别。number 类型即“可作为手牌进入推荐引擎”的信号。
  isNextBanner(data, stride, x0, y0) {
    if (!this.detailData) return false;
    const px = (x, y) => (y * stride + x) * 4;
    const spans = [];
    for (let y = 4; y < 40; y++) {
      let minx = 48, maxx = -1, white = 0;
      for (let x = 0; x < 48; x++) {
        const i = px(x0 + x, y0 + y);
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (r > 110 && r - g > 35 && r - b > 25) { if (x < minx) minx = x; if (x > maxx) maxx = x; }
      }
      if (maxx >= minx) for (let x = minx; x <= maxx; x++) {
        const i = px(x0 + x, y0 + y);
        if (data[i] > 195 && data[i + 1] > 195 && data[i + 2] > 195) white++;
      }
      spans.push(maxx < 0 ? null : { span: maxx - minx + 1, white });
    }
    let run = 0, runWhite = 0;
    for (let i = 0; i < spans.length; i++) {
      const row = spans[i];
      if (row && row.span >= 18) { run++; runWhite += row.white; continue; }
      if (run >= 6) {
        // 横幅之后红色必须停止（数字卡的红色笔画会一直延伸）。
        const quiet = spans.slice(i, i + 4).filter(r2 => r2 && r2.span >= 8).length;
        if (quiet <= 1 && runWhite >= 8) return true;
      }
      run = 0; runWhite = 0;
    }
    return false;
  }
  items() {
    const bar = this.itemBar;
    if (!bar) return null;
    const scale = this.detailData ? 2 : 1;
    const data = this.detailData ?? this.data;
    const stride = 1234 * scale;
    const slots = [];
    const slotW = bar.width / bar.slots;
    for (let s = 0; s < bar.slots; s++) {
      let colored = 0;
      const x0 = Math.round((bar.x + s * slotW) * scale), x1 = Math.round((bar.x + (s + 1) * slotW) * scale);
      const y0 = Math.round(bar.y * scale), y1 = Math.round((bar.y + bar.height) * scale);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * stride + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (Math.max(r, g, b) - Math.min(r, g, b) > 40 && Math.max(r, g, b) > 120) colored++;
      }
      if (colored <= 120 * scale * scale) { slots.push(null); continue; }
      if (this.isNextBanner(data, stride, x0 + Math.round(scale), y0 + Math.round(3 * scale))) { slots.push(29); continue; }
      if (!this.itemTemplates?.length) { slots.push("?"); continue; }
      const fp = new Float64Array(8 * 12 * 3);
      for (let gy = 0; gy < 12; gy++) for (let gx = 0; gx < 8; gx++) {
        const xa = x0 + Math.floor(gx / 8 * (x1 - x0)), xb = x0 + Math.floor((gx + 1) / 8 * (x1 - x0));
        const ya = y0 + Math.floor(gy / 12 * (y1 - y0)), yb = y0 + Math.floor((gy + 1) / 12 * (y1 - y0));
        let r = 0, g = 0, b = 0, n = 0;
        for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
          const i = (y * stride + x) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
        if (n) { const o = (gy * 8 + gx) * 3; fp[o] = r / n; fp[o + 1] = g / n; fp[o + 2] = b / n; }
      }
      let best = null, bestDist = Infinity, second = Infinity;
      for (const template of this.itemTemplates) {
        let d = 0;
        for (let i = 0; i < fp.length; i++) d += (fp[i] - template.fp[i]) ** 2;
        d = Math.sqrt(d);
        if (d < bestDist) { second = bestDist; bestDist = d; best = template; }
        else if (d < second) second = d;
      }
      slots.push(bestDist < 600 && second - bestDist > 150 ? (best.card ?? "#" + best.id) : "?");
    }
    return { slots, count: slots.filter(v => v !== null).length };
  }
  // 底栏行1“可投掷次数”：道具充能换来的可投掷余量（物品计数，
  // 与本局已投掷次数相互独立）。亮色渲染，与胶囊同阈值。
  charges() {
    if (!this.chargesWindow) return null;
    const read = this.matchGlyphs(this.chargesWindow, 135, 12);
    const value = read === null ? null : Number(read.text);
    return value !== null && value >= 0 && value <= 9999 ? value : null;
  }
  readCore(image, context, detail) {
    this.data = image.data;
    this.detailData = detail?.data ?? null;
    this.lastAnchorScore = 0;
    if (!this.visible()) return { visible: false, cn: true, issue: "covered", anchorScore: 0 };
    const position = this.number(), diceUsed = this.diceNumber(), items = this.items(), charges = this.charges();
    // 国服手牌 = 道具栏中识别到卡牌 ID 的槽位（number 值）。仅含
    // 已识别的卡是保守子集：识别不到的道具不会进入推荐，但也不会
    // 被误当作可用的卡。items 读不到（null）时 hand 为 null，区别
    // 于空手牌 []，供 tracker 决定保持旧值还是采用屏幕读数。
    const hand = items ? items.slots.filter(v => typeof v === "number") : null;
    return { visible: true, cn: true, position, diceUsed, charges, items, hand, bonusRoll: diceUsed === null ? null : false,
      issue: position === null ? "score" : diceUsed === null ? "dice" : null,
      anchorScore: Math.round(this.lastAnchorScore * 1000) / 1000 };
  }
  read(image, context, detail) { return this.readCore(image, context, detail); }
}
