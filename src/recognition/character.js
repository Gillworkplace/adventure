import { tileLayout } from "../content/board-layout.js";

// Sparse color samples from the existing game sprites. This reads one tile;
// it does not track the screen or require every phase of an animation.
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
    // A profile-confirmed identity tolerates the small color change seen in
    // idle animation. Unknown identities keep the stricter threshold.
    const presence = strict ? .10 : .08;
    let best = Infinity, id = null;
    const check = (template, limit = Infinity) => {
      const maximumError = template.points.length * 3 * 255 * limit;
      for (const dy of [-2, 0, 2]) for (const dx of [-2, 0, 2]) {
        let error = 0;
        for (const [x, y, r, g, b] of template.points) {
          const at = ((top + y + dy) * 1234 + left + x + dx) * 4;
          error += Math.abs(data[at] - r) + Math.abs(data[at + 1] - g) + Math.abs(data[at + 2] - b);
          // Error can only increase. Stop testing an alternate sprite as soon
          // as it cannot meet the presence threshold, without losing matches.
          if (error > maximumError) break;
        }
        if (error > maximumError) continue;
        const score = error / (template.points.length * 3 * 255);
        if (score < best) { best = score; id = template.id; }
      }
    };
    const preferred = this.templates.find(template => template.id === (knownId ?? this.preferred)) ?? this.templates[0];
    if (preferred) check(preferred);
    // The game allows avatar changes during play. A missing known sprite must
    // check every other playable avatar too, rather than look like movement.
    if (best > presence) for (const template of this.templates) if (template !== preferred) {
      check(template, .08);
      if (best <= .08) break;
    }
    if (!Number.isFinite(best) || !Number.isInteger(id)) return null;
    if (best <= presence) this.preferred = id;
    return { id, score: Math.round(best * 1000) / 1000, present: best <= presence };
  }
}
