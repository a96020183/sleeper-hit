// Settling the sealed forecast once released titles' songs are public. Pure functions; the
// script (scripts/settle.js) does the decrypting, hash checks and file writing.
//
// Fixed before the seal:
//   positives   pool artists in the new list, minus artists the earlier title used and artists in
//               trailers released before the seal
//   per title   AUC of each method over the pool (src/evaluate.js), and hits@50
//   Qloo        the sealed rank (affinity + popularity rank blend since 2026-10-23) decides the
//               verdict; the original excess-affinity ranking ("qlooExcess") is scored and reported
//               next to it, never used for the verdict
//   pooled      AUC averaged over titles, weighted by each title's positives
//   verdict     settleVerdict in src/evaluate.js (spec section 9); fewer than 10 positives = too few
import { scoreRanking, positivesFor, settleVerdict, TOP_K } from './evaluate.js';

export function settle({ pool, ranks, baselines, lists, priorLists = {}, knownBeforeSeal = {} }) {
  const poolNames = pool.map((a) => a.name);
  const perTitle = [];
  for (const [id, list] of Object.entries(lists)) {
    const rows = ranks.titles?.[id];
    if (!rows) continue;
    const exclude = [...(priorLists[id]?.artists || []), ...(knownBeforeSeal[id] || [])];
    const positives = positivesFor(poolNames, list.artists, exclude);
    const qlooRanking = rows.filter((r) => r.rank !== null).sort((a, b) => a.rank - b.rank).map((r) => r.name);
    const hasExcess = rows.some((r) => r.excessRank !== null && r.excessRank !== undefined);
    const excessRanking = hasExcess ? rows.filter((r) => r.excessRank !== null && r.excessRank !== undefined).sort((a, b) => a.excessRank - b.excessRank).map((r) => r.name) : null;
    const methods = {
      qloo: scoreRanking(poolNames, qlooRanking, positives),
      qlooExcess: excessRanking ? scoreRanking(poolNames, excessRanking, positives) : null,
      popularity: baselines.popularity?.ranking ? scoreRanking(poolNames, baselines.popularity.ranking, positives) : null,
      llm: baselines.llm?.byTitle?.[id] ? scoreRanking(poolNames, baselines.llm.byTitle[id], positives) : null,
      similarTitles: baselines.similarTitles?.byTitle?.[id] ? scoreRanking(poolNames, baselines.similarTitles.byTitle[id], positives) : null,
    };
    perTitle.push({ id, source: list.source, checkedOn: list.checkedOn, positives: positives.length, methods });
  }
  const total = perTitle.reduce((s, t) => s + t.positives, 0);
  const pooled = {};
  for (const m of ['qloo', 'qlooExcess', 'popularity', 'llm', 'similarTitles']) {
    const rows = perTitle.filter((t) => t.positives > 0 && t.methods[m]?.auc !== null && t.methods[m]?.auc !== undefined);
    const w = rows.reduce((s, t) => s + t.positives, 0);
    pooled[m] = w ? +(rows.reduce((s, t) => s + t.methods[m].auc * t.positives, 0) / w).toFixed(3) : null;
  }
  const { qlooExcess, ...forVerdict } = pooled;
  const verdict = settleVerdict({ positives: total, ...forVerdict });
  return {
    topK: TOP_K,
    positives: total,
    pooledAuc: pooled,
    ...verdict,
    perTitle: perTitle.map((t) => ({
      ...t,
      methods: Object.fromEntries(Object.entries(t.methods).map(([k, m]) => [k, m ? { auc: m.auc === null ? null : +m.auc.toFixed(3), hits: m.hits, hitNames: m.hitNames } : null])),
    })),
  };
}
