// Whole-pool forecast: every sealed title ranks the full artist pool.
// Used by scripts/premise.js (key-day checks) and scripts/seal.js (the sealed forecast).
// Seal score since 2026-10-23: the affinity + popularity rank blend (blendRanks), chosen after the
// backtest because it was the only Qloo use that cleared the registered bar. The original score,
// excess affinity (band percentile), is sealed in the same file and reported next to it.
import { config } from './config.js';
import { WINDOWS } from './data/windows.js';
import { bandPercentiles, blendRanks, spearman, kendallTau, premiseVerdict, median } from './scoring.js';

export async function scorePool(client, { n = config.poolN, windows = WINDOWS.filter((w) => w.sealed), log = () => {} } = {}) {
  const pool = await client.buildPool(n);
  log(`pool: ${pool.length} artists`);
  const titles = {};
  const failures = [];
  for (const w of windows) {
    try {
      const sig = await client.resolve({ query: w.earlier.query, type: w.earlier.type, name: w.earlier.name || w.earlier.query, year: w.earlier.year });
      const aff = await client.scoreArtists(sig.id, pool.map((a) => a.id));
      const affMap = new Map([...aff].map(([id, v]) => [id, v.affinity]));
      const bp = bandPercentiles(pool, affMap, config.poolBands);
      const blend = blendRanks(pool, affMap);
      const scoredIds = pool.filter((a) => affMap.has(a.id));
      const rho = spearman(scoredIds.map((a) => affMap.get(a.id)), scoredIds.map((a) => a.popularity));
      titles[w.id] = { title: w.title, signal: w.earlier.label, signalId: sig.id, affinity: affMap, bands: bp, blend, scored: scoredIds.length, spearman: rho };
      log(`${w.id}: scored ${scoredIds.length}/${pool.length}, spearman(affinity, popularity) = ${rho?.toFixed(3)}`);
    } catch (e) {
      failures.push({ id: w.id, error: e.message });
      log(`${w.id}: FAILED ${e.message}`);
    }
  }
  return { pool, titles, failures };
}

export function premise({ pool, titles }) {
  const ids = Object.keys(titles);
  const spearmans = ids.map((id) => titles[id].spearman).filter((v) => v !== null);
  const taus = [];
  const pairs = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = titles[ids[i]].bands, b = titles[ids[j]].bands;
      const common = pool.filter((p) => a.get(p.id)?.pct !== null && b.get(p.id)?.pct !== null && a.has(p.id) && b.has(p.id));
      const t = kendallTau(common.map((p) => a.get(p.id).pct), common.map((p) => b.get(p.id).pct));
      if (t !== null) { taus.push(t); pairs.push({ a: ids[i], b: ids[j], tau: t, n: common.length }); }
    }
  }
  return { perTitle: ids.map((id) => ({ id, spearman: titles[id].spearman, scored: titles[id].scored })), pairs, medianTau: median(taus), ...premiseVerdict(spearmans, taus) };
}

// Ranks file for the seal: per title, every pool artist with its blend rank (the scored ranking),
// the two ranks it averages, and the original excess-affinity score (band percentile and its rank).
export function ranksFile({ pool, titles }, sealedAt) {
  const out = { sealedAt, score: 'rank = affinity + popularity rank blend (since 2026-10-23); excessRank = original excess-affinity ranking, reported alongside', titles: {} };
  for (const [id, t] of Object.entries(titles)) {
    const rows = pool.map((a) => {
      const b = t.blend.get(a.id);
      const pct = t.bands.get(a.id)?.pct ?? null;
      return {
        name: a.name, id: a.id, rank: b?.rank ?? null, affinityRank: b?.affinityRank ?? null, popularityRank: b?.popularityRank ?? null,
        bandPct: pct === null ? null : +pct.toFixed(2), affinity: t.affinity.get(a.id) ?? null, popularity: a.popularity,
      };
    });
    const byExcess = rows.filter((r) => r.bandPct !== null)
      .sort((x, y) => y.bandPct - x.bandPct || (t.affinity.get(y.id) ?? 0) - (t.affinity.get(x.id) ?? 0));
    const excessRank = new Map(byExcess.map((r, i) => [r.id, i + 1]));
    for (const r of rows) r.excessRank = excessRank.get(r.id) ?? null;
    rows.sort((x, y) => (x.rank ?? Infinity) - (y.rank ?? Infinity));
    out.titles[id] = rows;
  }
  return out;
}
