// The agent's trade-off: which doors to knock on today, in what order, and why not the others.
// Ranking rules (fixed, compared in order):
//   1. Clearance: one-stop > cover clearable > needs consent > unconfirmed (unconfirmed gets no letter)
//   2. Timing: inside the 14-60 day window first; announced dates before estimated ones
//   3. Audience score: higher percentile on the affinity + popularity rank blend among the pool
//      first (excess affinity until 2026-10-23); below top 50% = skip
//   4. Tie-break: audience overlap (demographics)
// Output: at most DAILY_CAP letters per artist per day; every other door gets a one-line reason.
import { CATEGORY_RANK } from './clearance.js';
import { topPercent } from './scoring.js';

export const DAILY_CAP = 3;
export const MIN_PERCENTILE = 50;
const TIMING_RANK = { 'in-window': 0, early: 1, 'too-late': 2, unknown: 3 };

export function rankKey(d) {
  return [
    CATEGORY_RANK[d.clearance.category] ?? 9,
    TIMING_RANK[d.timing.bucket] ?? 9,
    d.timing.dateStatus === 'announced' ? 0 : 1,
    -(d.pct ?? -1),
    -(d.overlap ?? -1),
  ];
}

export function compareDoors(a, b) {
  const ka = rankKey(a), kb = rankKey(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return 0;
}

export function skipReason(d) {
  if (d.clearance.category === 'unconfirmed') return `Clearance unconfirmed. ${d.clearance.reason}`;
  if (d.timing.bucket !== 'in-window') {
    const r = d.timing.reason || 'outside the window';
    return r.charAt(0).toUpperCase() + r.slice(1) + '.';
  }
  if (d.pct === null || d.pct === undefined) return 'Qloo has too little data on this audience to score the artist.';
  if (d.pct < MIN_PERCENTILE) return `Top ${topPercent(d.pct)}% of the pool for this audience, below the top-50% bar.`;
  return null;
}

// doors: [{ id, clearance, timing, pct, overlap }]; overrides: Set of door ids a person flipped back.
export function decide(doors, { cap = DAILY_CAP, overrides = new Set() } = {}) {
  const ranked = [...doors].sort(compareDoors);
  let letters = 0;
  return ranked.map((d, i) => {
    const reason = skipReason(d);
    if (overrides.has(d.id)) return { ...d, order: i + 1, action: 'letter', overridden: true, reason: reason || '' };
    if (reason) return { ...d, order: i + 1, action: 'skip', reason };
    if (letters >= cap) return { ...d, order: i + 1, action: 'skip', reason: `Daily limit of ${cap} letters reached. First in line tomorrow.` };
    letters++;
    return { ...d, order: i + 1, action: 'letter', reason: '' };
  });
}
