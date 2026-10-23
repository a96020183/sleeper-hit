// Scoring maths. Pure functions, no I/O.

// Percentile of `value` among `values` (0-100): share below plus half the ties.
export function percentileOf(value, values) {
  if (!values.length) return null;
  let below = 0, ties = 0;
  for (const v of values) { if (v < value) below++; else if (v === value) ties++; }
  return (100 * (below + 0.5 * ties)) / values.length;
}

// Split a pool into `n` popularity bands of (near) equal size, most popular first.
export function assignBands(pool, n = 10) {
  const sorted = [...pool].sort((a, b) => b.popularity - a.popularity);
  const out = new Map();
  sorted.forEach((a, i) => out.set(a.id, Math.min(n - 1, Math.floor((i * n) / sorted.length))));
  return out;
}

// "Excess affinity": each artist's affinity percentile inside its own popularity band.
// The card and seal score until 2026-10-23; still sealed alongside the blend for comparison.
// affinities: Map id -> number. Unscored artists get null.
export function bandPercentiles(pool, affinities, n = 10) {
  const bands = assignBands(pool, n);
  const members = Array.from({ length: n }, () => []);
  for (const a of pool) if (affinities.has(a.id)) members[bands.get(a.id)].push(affinities.get(a.id));
  const out = new Map();
  for (const a of pool) {
    const b = bands.get(a.id);
    out.set(a.id, { band: b, pct: affinities.has(a.id) ? percentileOf(affinities.get(a.id), members[b]) : null });
  }
  return out;
}

// Card and seal score since 2026-10-23 (chosen after the backtest; see README): the average of an
// artist's rank by raw affinity and its rank by popularity, among the artists Qloo scored. Ties by
// raw affinity. Same definition as "qlooBlend" in seal/backtest-v2-method.json.
// artists: [{ id, popularity }]; affinities: Map id -> number. Unscored artists are left out.
// Returns Map id -> { rank, affinityRank, popularityRank, n, pct } (ranks 1 = best, pct 0-100).
export function blendRanks(artists, affinities) {
  const s = artists.filter((a) => affinities.has(a.id));
  const n = s.length;
  const aff = (a) => affinities.get(a.id);
  const affRank = new Map([...s].sort((x, y) => aff(y) - aff(x)).map((a, i) => [a.id, i]));
  const popRank = new Map([...s].sort((x, y) => y.popularity - x.popularity).map((a, i) => [a.id, i]));
  const order = [...s].sort((x, y) => (affRank.get(x.id) + popRank.get(x.id)) - (affRank.get(y.id) + popRank.get(y.id)) || aff(y) - aff(x));
  const out = new Map();
  order.forEach((a, i) => out.set(a.id, {
    rank: i + 1, affinityRank: affRank.get(a.id) + 1, popularityRank: popRank.get(a.id) + 1, n, pct: (100 * (n - i - 0.5)) / n,
  }));
  return out;
}

// "Top X%" as shown on cards: 100 minus the percentile, never below 1.
export const topPercent = (pct) => (pct === null || pct === undefined ? null : Math.max(1, Math.round(100 - pct)));

function ranks(xs) {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

export function pearson(x, y) {
  const n = x.length;
  if (n < 2) return null;
  const mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

export const spearman = (x, y) => pearson(ranks(x), ranks(y));

// Kendall tau-b.
export function kendallTau(x, y) {
  const n = x.length;
  let c = 0, d = 0, tx = 0, ty = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = Math.sign(x[i] - x[j]), b = Math.sign(y[i] - y[j]);
      if (a === 0 && b === 0) continue;
      if (a === 0) tx++;
      else if (b === 0) ty++;
      else if (a === b) c++;
      else d++;
    }
  }
  const den = Math.sqrt((c + d + tx) * (c + d + ty));
  return den ? (c - d) / den : null;
}

export function median(xs) {
  const s = xs.filter((v) => v !== null && !Number.isNaN(v)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// AUC: probability that a random positive outscores a random negative (ties count half).
export function auc(scores, labels) {
  const pos = [], neg = [];
  scores.forEach((s, i) => (labels[i] ? pos : neg).push(s));
  if (!pos.length || !neg.length) return null;
  let win = 0;
  for (const p of pos) for (const q of neg) win += p > q ? 1 : p === q ? 0.5 : 0;
  return win / (pos.length * neg.length);
}

// Premise 1 verdict (fixed before key day).
// Spearman(affinity, popularity) per title: median <= 0.5 pass; > 0.8 (or 3/4 of titles > 0.8) fail;
// in between, pairwise Kendall tau of excess-affinity rankings must have median < 0.5.
// Low correlation but tau median >= 0.8 (every title picks the same artists) also fails.
export function premiseVerdict(spearmans, taus) {
  const rho = median(spearmans);
  const tau = median(taus);
  const highShare = spearmans.filter((v) => v > 0.8).length / Math.max(1, spearmans.length);
  if (rho === null) return { verdict: 'no-data', rho, tau };
  if (rho > 0.8 || highShare >= 0.75) return { verdict: 'fail', rho, tau, why: 'affinity mostly tracks popularity' };
  if (tau !== null && tau >= 0.8) return { verdict: 'fail', rho, tau, why: 'every title ranks the same artists' };
  if (rho <= 0.5) return { verdict: 'pass', rho, tau };
  if (tau !== null && tau < 0.5) return { verdict: 'pass', rho, tau, why: 'correlation is moderate but rankings are title-specific' };
  return { verdict: 'fail', rho, tau, why: 'moderate correlation and rankings not title-specific enough' };
}

// Audience overlap from Qloo demographics.
// Qloo returns relative scores per age band and gender (about -1..1, 0 = average), not shares.
// We turn them into shares against an even baseline: share ~ max(0, 1 + score), normalised,
// combine age x gender assuming independence, then sum the smaller share in each cell (0-1).
// The even baseline is our assumption; Qloo does not publish the population mix behind the scores.
export const AGE_BANDS = ['24_and_younger', '25_to_29', '30_to_34', '35_to_44', '45_to_54', '55_and_older'];

function shares(obj, keys) {
  const raw = keys.map((k) => Math.max(0, 1 + (Number(obj?.[k]) || 0)));
  const s = raw.reduce((a, b) => a + b, 0) || 1;
  return raw.map((v) => v / s);
}

export function demographicCells(q) {
  const age = shares(q.age, AGE_BANDS);
  const gender = shares(q.gender, ['male', 'female']);
  const cells = [];
  for (const a of age) for (const g of gender) cells.push(a * g);
  return cells;
}

export function audienceOverlap(qa, qb) {
  if (!qa?.age || !qb?.age) return null;
  const a = demographicCells(qa), b = demographicCells(qb);
  return a.reduce((s, v, i) => s + Math.min(v, b[i]), 0);
}
