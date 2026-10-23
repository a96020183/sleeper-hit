// Whole-pool forecast: every sealed title ranks the full artist pool by excess affinity.
// Used by scripts/premise.js (key-day checks) and scripts/seal.js (the sealed forecast).
import { config } from './config.js';
import { WINDOWS } from './data/windows.js';
import { bandPercentiles, spearman, kendallTau, premiseVerdict, median } from './scoring.js';

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
      const scoredIds = pool.filter((a) => affMap.has(a.id));
      const rho = spearman(scoredIds.map((a) => affMap.get(a.id)), scoredIds.map((a) => a.popularity));
      titles[w.id] = { title: w.title, signal: w.earlier.label, signalId: sig.id, affinity: affMap, bands: bp, scored: scoredIds.length, spearman: rho };
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

// Ranks file for the seal: per title, every pool artist with rank and band percentile.
export function ranksFile({ pool, titles }, sealedAt) {
  const out = { sealedAt, titles: {} };
  for (const [id, t] of Object.entries(titles)) {
    const rows = pool
      .map((a) => ({ name: a.name, id: a.id, bandPct: t.bands.get(a.id)?.pct ?? null, affinity: t.affinity.get(a.id) ?? null, popularity: a.popularity }))
      .sort((x, y) => (y.bandPct ?? -1) - (x.bandPct ?? -1));
    rows.forEach((r, i) => { r.rank = r.bandPct === null ? null : i + 1; r.bandPct = r.bandPct === null ? null : +r.bandPct.toFixed(2); });
    out.titles[id] = rows;
  }
  return out;
}
