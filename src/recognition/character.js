import { tileLayout } from "../content/board-layout.js";

// 取自现有游戏精灵图的稀疏颜色采样。它只读取一个格子；
// 不追踪屏幕，也不要求动画的每个阶段。
export class CharacterProbe {
  constructor(templates = []) { this.templates = templates; }
  read(data, position, knownId, strict = false) {
    if (!this.templates.length || !tileLayout[position - 1]) return null;
    const grid = tileLayout[position - 1][1] - 1;
    const left = 250 + grid % 10 * 96, top = 15 + Math.floor(grid / 10) * 96;
    return this.readAt(data, left, top, knownId, strict);
  }
  profile(data) {
    if (!this.templates.length) return null;
    return this.readAt(data, 58, 88, this.profileId);
  }
  readAt(data, left, top, knownId, strict = false) {
    // 经资料页确认过的身份可以容忍待机动画中出现的轻微颜色变化。
    // 未知身份则保持更严格的阈值。
    const presence = strict ? .10 : .08;
    let best = Infinity, id = null;
    const check = (template, limit = Infinity) => {
      const maximumError = template.points.length * 3 * 255 * limit;
      for (const dy of [-2, 0, 2]) for (const dx of [-2, 0, 2]) {
        let error = 0;
        for (const [x, y, r, g, b] of template.points) {
          const at = ((top + y + dy) * 1234 + left + x + dx) * 4;
          error += Math.abs(data[at] - r) + Math.abs(data[at + 1] - g) + Math.abs(data[at + 2] - b);
          // 误差只会增大。某个候选精灵图一旦已不可能满足在场阈值，
          // 就立即停止对它的测试，且不会因此丢失匹配。
          if (error > maximumError) break;
        }
        if (error > maximumError) continue;
        const score = error / (template.points.length * 3 * 255);
        if (score < best) { best = score; id = template.id; }
      }
    };
    const preferred = this.templates.find(template => template.id === (knownId ?? this.preferred)) ?? this.templates[0];
    if (preferred) check(preferred);
    // 游戏允许在游玩过程中更换头像。已知精灵图缺失时，必须把其他
    // 所有可玩头像也检查一遍，而不是让它看起来像一次移动。
    if (best > presence) for (const template of this.templates) if (template !== preferred) {
      check(template, .08);
      if (best <= .08) break;
    }
    if (!Number.isFinite(best) || !Number.isInteger(id)) return null;
    if (best <= presence) this.preferred = id;
    return { id, score: Math.round(best * 1000) / 1000, present: best <= presence };
  }
}
