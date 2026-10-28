// The agent's trade-off: which doors to knock on today, in what order, and why not the others.
// Ranking rules (fixed, compared in order):
//   1. Clearance: one-stop > cover clearable > needs consent > unconfirmed (unconfirmed gets no letter)
//   2. Timing: inside the 14-60 day window first; announced dates before estimated ones
//   3. Audience score: higher percentile on the affinity + popularity rank blend among the pool
//      first (excess affinity until 2026-10-23); outside the top 20% = skip (was top 50% until
//      2026-10-24; now the same bar as the find-sleepers selection rule)
//      Since 2026-10-28 (after review, not backtested): the earlier title's audience must also rank
//      the artist inside its top 20% by affinity alone, so popularity cannot carry a letter by itself
//   0. An artist that is not quiet gets no letters (a person can still knock anyway)
//   4. Tie-break: audience overlap (demographics)
// Output: at most DAILY_CAP letters per artist per day; every other door gets a one-line reason.
import { CATEGORY_RANK } from './clearance.js';
import { topPercent } from './scoring.js';

export const DAILY_CAP = 3;
export const MIN_PERCENTILE = 80;
export const AFFINITY_TOP_SHARE = 0.2; // affinity floor: affinity rank within the top 20% of the scored pool
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

// The affinity floor. Not applied to the "popularity alone" comparison (d.popularityOnly), which has no Qloo signal.
export function weakAudience(d) {
  if (d.popularityOnly || !d.blend || !d.blend.of) return false;
  return d.blend.affinityRank > Math.ceil(d.blend.of * AFFINITY_TOP_SHARE);
}

export function skipReason(d) {
  if (d.clearance.category === 'unconfirmed') return `Clearance unconfirmed. ${d.clearance.reason}`;
  if (d.timing.bucket !== 'in-window') {
    const r = d.timing.reason || 'outside the window';
    return r.charAt(0).toUpperCase() + r.slice(1) + '.';
  }
  if (d.pct === null || d.pct === undefined) return 'Qloo has too little data on this audience to score the artist.';
  if (d.pct < MIN_PERCENTILE) return `Card score too low: top ${topPercent(d.pct)}%. We knock only inside the top ${100 - MIN_PERCENTILE}%.`;
  if (weakAudience(d)) {
    const who = d.window?.earlier?.label ? `${d.window.earlier.label} fans` : 'The audience';
    return `Popularity carries this one: ${who} rank them only No. ${d.blend.affinityRank.toLocaleString('en-US')} of ${d.blend.of.toLocaleString('en-US')} by affinity. We knock only when the audience itself puts them in its top ${Math.round(AFFINITY_TOP_SHARE * 100)}%.`;
  }
  return null;
}

// doors: [{ id, clearance, timing, pct, overlap }]; overrides: Set of door ids a person flipped back.
// block: a reason that stops every letter for this artist today (e.g. not quiet). It comes first, as in the README order.
export function decide(doors, { cap = DAILY_CAP, overrides = new Set(), block = null } = {}) {
  const ranked = [...doors].sort(compareDoors);
  let letters = 0;
  return ranked.map((d, i) => {
    const reason = block || skipReason(d);
    if (overrides.has(d.id)) return { ...d, order: i + 1, action: 'letter', overridden: true, reason: reason || '' };
    if (reason) return { ...d, order: i + 1, action: 'skip', reason };
    if (letters >= cap) return { ...d, order: i + 1, action: 'skip', reason: `Already ${cap} letters today for this artist. First in line tomorrow.` };
    letters++;
    return { ...d, order: i + 1, action: 'letter', reason: '' };
  });
}
