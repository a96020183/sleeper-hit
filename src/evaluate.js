// One scorer for both the historical backtest and the settlement of the sealed forecast, so the
// numbers judges see now are computed the same way as the ones that come later.
//
// Fixed before any result was computed (2026-10-23):
//   positives  pool artists (matched by normalised name) that the later title actually used
//   primary    hits@50: how many positives a method puts in its top 50 of the pool
//   secondary  AUC over the whole pool; a method that ranks only a shortlist (the LLM, "similar
//              titles") puts everyone else in one tie at the bottom
import { auc } from './scoring.js';
import { normName } from './baselines.js';

export const TOP_K = 50;

// ranking: names, best first (may be a shortlist). Returns hits@K, AUC and the names hit.
export function scoreRanking(poolNames, ranking, positives, k = TOP_K) {
  const pos = new Set([...positives].map(normName));
  const order = new Map();
  ranking.forEach((n, i) => { const key = normName(n); if (!order.has(key)) order.set(key, i); });
  const top = ranking.slice(0, k).map(normName);
  const hits = poolNames.filter((n) => pos.has(normName(n)) && top.includes(normName(n)));
  const scores = poolNames.map((n) => (order.has(normName(n)) ? ranking.length - order.get(normName(n)) : 0));
  const labels = poolNames.map((n) => (pos.has(normName(n)) ? 1 : 0));
  return { hits: hits.length, hitNames: hits, auc: auc(scores, labels), ranked: ranking.length };
}

// Pool artists that appear in a soundtrack list, minus names to exclude (repeats, pre-seal trailers).
export function positivesFor(poolNames, usedArtists, exclude = []) {
  const used = new Set(usedArtists.map(normName));
  const ex = new Set(exclude.map(normName));
  return poolNames.filter((n) => used.has(normName(n)) && !ex.has(normName(n)));
}

// Sum per-pair results into totals per method.
export function totals(perPair, methods) {
  const out = {};
  for (const m of methods) {
    const rows = perPair.map((p) => p.methods[m]).filter(Boolean);
    const aucs = rows.map((r) => r.auc).filter((v) => v !== null);
    out[m] = { hits: rows.reduce((s, r) => s + r.hits, 0), meanAuc: aucs.length ? +(aucs.reduce((s, v) => s + v, 0) / aucs.length).toFixed(3) : null };
  }
  return out;
}

// Backtest verdict (fixed): Qloo is "ahead" only with more hits@50 than both popularity and the LLM.
export function backtestVerdict(t, positives) {
  if (positives === 0) return { verdict: 'no-data', why: 'no positives in the pool' };
  if (!t.llm) return { verdict: 'incomplete', why: 'LLM baseline missing' };
  const q = t.qloo.hits;
  if (q > t.llm.hits && q > t.popularity.hits) return { verdict: 'qloo-ahead', why: `Qloo ${q} vs LLM ${t.llm.hits} vs popularity ${t.popularity.hits} hits in the top ${TOP_K}` };
  return { verdict: 'qloo-not-ahead', why: `Qloo ${q} vs LLM ${t.llm.hits} vs popularity ${t.popularity.hits} hits in the top ${TOP_K}` };
}

// Settlement verdict for the sealed forecast (fixed in the spec, section 9): pooled AUC of Qloo
// excess affinity must reach 0.65 and beat all three baselines; 0.55 or lower, or losing to
// popularity or the LLM, fails. Fewer than 10 positives: too few to count.
export function settleVerdict({ positives, qloo, popularity, llm, similarTitles }) {
  if (positives < 10) return { verdict: 'too-few', why: `${positives} positives so far; the bar is 10` };
  if (qloo === null) return { verdict: 'no-data', why: 'no Qloo score' };
  if (qloo <= 0.55 || (popularity !== null && qloo <= popularity) || (llm !== null && qloo <= llm)) return { verdict: 'fail', why: 'AUC 0.55 or lower, or not above popularity or the LLM' };
  const beatsAll = [popularity, llm, similarTitles].every((b) => b === null || qloo > b);
  if (qloo >= 0.65 && beatsAll) return { verdict: 'pass', why: 'AUC 0.65 or higher and above all three baselines' };
  return { verdict: 'unsteady', why: 'some signal, not enough to pass' };
}
