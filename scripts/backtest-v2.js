// Backtest v2: does the earlier title's Qloo audience point to the artists its sequel newly used,
// better than popularity and an LLM? Everything here follows seal/backtest-v2-method.json, which was
// committed (034f21e) before any list was collected or any number computed. The script refuses to
// run if that file has changed since. Usage: npm run backtest
//
// Public output: seal/backtest-v2.json (counts, AUCs, intervals, names hit; no Qloo values).
// Private output: .private/backtest-v2-<date>.json (adds LLM picks and per-artist flags).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { config, ROOT } from '../src/config.js';
import { QlooClient } from '../src/qloo/client.js';
import { bandPercentiles } from '../src/scoring.js';
import { llmBaseline, normName } from '../src/baselines.js';
import { scoreRanking, pooledAuc, clusterBootstrap, TOP_K } from '../src/evaluate.js';
import { creditsInPool } from '../src/answerkey.js';
import { Wiki } from '../src/wiki.js';
import { CANDIDATES } from '../src/data/backtest_v2_candidates.js';

const REGISTERED = '034f21e';
const METHOD_FILE = 'seal/backtest-v2-method.json';
const norm = (s) => s.replace(/\r\n/g, '\n');
const registered = execFileSync('git', ['show', `${REGISTERED}:${METHOD_FILE}`], { cwd: ROOT, encoding: 'utf8' });
const method = JSON.parse(registered);
if (norm(registered) !== norm(fs.readFileSync(path.join(ROOT, METHOD_FILE), 'utf8'))) {
  console.error(`${METHOD_FILE} differs from the registered commit ${REGISTERED}. Refusing to run.`);
  process.exit(1);
}
console.log(`Method registered in commit ${REGISTERED}.`);

const BUDGET = 1400;
const CUTOFF = '2024-06-01';
const LISTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'backtest_v2_lists.json'), 'utf8')).lists;
const regById = Object.fromEntries(method.candidates.list.map((c) => [c.id, c]));
const yearOf = (s) => +(String(s).match(/\((\d{4})/) || [])[1] || null;

const client = new QlooClient();
if (client.mode !== 'live') { console.error('Needs the live Qloo key.'); process.exit(1); }
const pool = await client.buildPool(config.poolN);
const poolNames = pool.map((a) => a.name);
const byPop = [...pool].sort((a, b) => b.popularity - a.popularity);
const popRank = new Map(byPop.map((a, i) => [a.id, i]));
const tertileOf = new Map(byPop.map((a, i) => [a.name, i < 1000 ? 'high' : i < 2000 ? 'mid' : 'low']));
const TERTILES = ['high', 'mid', 'low'];
const tertileNames = Object.fromEntries(TERTILES.map((t) => [t, poolNames.filter((n) => tertileOf.get(n) === t)]));
const startLive = client.http.stats.live;

async function resolveSignal(s) {
  for (const name of s.names || [s.query]) {
    for (const year of [s.year, undefined]) {
      try { return await client.resolve({ query: name, type: s.type, name, year }); } catch { /* next */ }
    }
  }
  return null;
}

// Pass 1: answer keys and positives (no Qloo).
const pairs = [], excluded = [];
for (const c of CANDIDATES) {
  const l = LISTS[c.id];
  if (!l || l.later.missing) { excluded.push({ id: c.id, why: 'no lawful list for the later title' }); continue; }
  const later = creditsInPool(l.later.credits, poolNames);
  const earlier = new Set(creditsInPool(l.earlier.credits, poolNames).map(normName));
  const positives = later.filter((n) => !earlier.has(normName(n)));
  if (!positives.length) { excluded.push({ id: c.id, why: `no positives (${later.length} pool artists on the later list, all repeats)` }); continue; }
  pairs.push({ ...c, reg: regById[c.id], positives, laterInPool: later.length, repeatsRemoved: !l.earlier.missing,
    sources: l.later.used.map((u) => u.source), earlierSources: l.earlier.used.map((u) => u.source) });
}

// Similar titles: other candidates' lists released before this later title (registered rule).
const listDates = [];
for (const c of CANDIDATES) {
  const l = LISTS[c.id];
  if (!l) continue;
  listDates.push({ owner: c.id, key: JSON.stringify(c.laterSrc), date: c.laterDate, artists: creditsInPool(l.later.credits, poolNames) });
  const ey = yearOf(regById[c.id]?.earlier);
  if (ey) listDates.push({ owner: c.id, key: JSON.stringify(c.earlierSrc), date: `${ey}-01-01`, artists: creditsInPool(l.earlier.credits, poolNames), yearOnly: true });
}
function similarRanking(p) {
  const own = JSON.stringify(p.earlierSrc);
  const ly = p.laterDate.slice(0, 4);
  const count = new Map();
  for (const d of listDates) {
    if (d.owner === p.id || d.key === own) continue;
    const before = d.yearOnly ? d.date.slice(0, 4) < ly : d.date < p.laterDate;
    if (!before) continue;
    for (const n of d.artists) count.set(n, (count.get(n) || 0) + 1);
  }
  return byPop.filter((a) => count.get(a.name) > 0).sort((a, b) => count.get(b.name) - count.get(a.name) || popRank.get(a.id) - popRank.get(b.id)).map((a) => a.name);
}

// Pass 2: Qloo scores within budget, then LLM baselines.
const scored = [];
for (const p of pairs) {
  if (client.http.stats.live - startLive + 64 > BUDGET) { excluded.push({ id: p.id, why: 'Qloo budget reached' }); continue; }
  const sig = await resolveSignal(p.signal);
  if (!sig) { excluded.push({ id: p.id, why: `Qloo signal not resolved (${p.signal.query})` }); continue; }
  const aff = await client.scoreArtists(sig.id, pool.map((a) => a.id));
  const A = new Map([...aff].map(([id, v]) => [id, v.affinity]));
  const bands = bandPercentiles(pool, A, config.poolBands);
  const s = pool.filter((a) => A.has(a.id));
  const affRank = new Map([...s].sort((x, y) => A.get(y.id) - A.get(x.id)).map((a, i) => [a.id, i]));
  const sPopRank = new Map([...s].sort((x, y) => y.popularity - x.popularity).map((a, i) => [a.id, i]));
  const names = (arr) => arr.map((a) => a.name);
  p.rank = {
    popularity: names(byPop),
    qlooRaw: names([...s].sort((x, y) => A.get(y.id) - A.get(x.id))),
    qlooExcess: names([...s].sort((x, y) => bands.get(y.id).pct - bands.get(x.id).pct || A.get(y.id) - A.get(x.id))),
    qlooTimesPop: names([...s].sort((x, y) => A.get(y.id) * y.popularity - A.get(x.id) * x.popularity)),
    qlooBlend: names([...s].sort((x, y) => (affRank.get(x.id) + sPopRank.get(x.id)) - (affRank.get(y.id) + sPopRank.get(y.id)) || A.get(y.id) - A.get(x.id))),
    similarTitles: similarRanking(p),
  };
  p.scoredCount = s.length;
  scored.push(p);
  console.log(`${p.id.padEnd(20)} positives ${String(p.positives.length).padStart(3)}  scored ${s.length}  (Qloo live so far ${client.http.stats.live - startLive})`);
}

const titleOf = (p) => ({ id: p.id, title: p.later, earlier: p.reg?.earlier || p.signal.query });
const llm = await llmBaseline(poolNames, scored.map(titleOf));
const llmTail = await llmBaseline(tertileNames.low, scored.map(titleOf));
for (const p of scored) { p.rank.llm = llm.byTitle?.[p.id] || []; p.rank.llmTail = llmTail.byTitle?.[p.id] || []; }

// Metrics per pair: whole pool and each tertile.
const METHODS = ['popularity', 'llm', 'similarTitles', 'qlooRaw', 'qlooExcess', 'qlooTimesPop', 'qlooBlend'];
const QLOO = ['qlooRaw', 'qlooExcess', 'qlooTimesPop', 'qlooBlend'];
function metricsFor(p, universe, methods) {
  const U = new Set(universe);
  const pos = p.positives.filter((n) => U.has(n));
  const out = {};
  for (const m of methods) {
    const r = scoreRanking(universe, p.rank[m].filter((n) => U.has(n)), pos);
    out[m] = { auc: r.auc, hits: r.hits, hitNames: r.hitNames, positives: pos.length };
  }
  return out;
}
for (const p of scored) {
  p.all = metricsFor(p, poolNames, METHODS);
  p.tert = Object.fromEntries(TERTILES.map((t) => [t, metricsFor(p, tertileNames[t], t === 'low' ? [...METHODS, 'llmTail'] : METHODS)]));
}

const r3 = (x) => (x === null || x === undefined ? null : +x.toFixed(3));
const ci = (o) => ({ value: r3(o.value), lo: r3(o.lo), hi: r3(o.hi) });
function summarize(rows, key, methods) {
  const pr = rows.map((p) => ({ franchise: p.franchise, m: key(p) })).filter((x) => x.m && Object.values(x.m)[0].positives > 0);
  if (!pr.length) return { pairs: 0, positives: 0 };
  const auc = (m) => (ps) => pooledAuc(ps.map((x) => x.m[m]));
  const hits = (m) => (ps) => ps.reduce((s, x) => s + x.m[m].hits, 0);
  const stats = {};
  for (const m of methods) { stats[`auc:${m}`] = auc(m); stats[`hits:${m}`] = hits(m); }
  const llmKey = methods.includes('llmTail') ? 'llmTail' : 'llm';
  for (const q of QLOO) {
    stats[`aucDiffPop:${q}`] = (ps) => { const a = auc(q)(ps), b = auc('popularity')(ps); return a === null || b === null ? null : a - b; };
    stats[`aucDiffLlm:${q}`] = (ps) => { const a = auc(q)(ps), b = auc(llmKey)(ps); return a === null || b === null ? null : a - b; };
    stats[`hitsDiffLlm:${q}`] = (ps) => hits(q)(ps) - hits(llmKey)(ps);
    stats[`hitsDiffPop:${q}`] = (ps) => hits(q)(ps) - hits('popularity')(ps);
  }
  const b = clusterBootstrap(pr, stats);
  return {
    pairs: pr.length, franchises: new Set(pr.map((x) => x.franchise)).size,
    positives: pr.reduce((s, x) => s + Object.values(x.m)[0].positives, 0), llmComparedWith: llmKey,
    pooledAuc: Object.fromEntries(methods.map((m) => [m, ci(b[`auc:${m}`])])),
    hits: Object.fromEntries(methods.map((m) => [m, ci(b[`hits:${m}`])])),
    qlooVs: Object.fromEntries(QLOO.map((q) => [q, {
      aucMinusPopularity: ci(b[`aucDiffPop:${q}`]), aucMinusLlm: ci(b[`aucDiffLlm:${q}`]),
      hitsMinusLlm: ci(b[`hitsDiffLlm:${q}`]), hitsMinusPopularity: ci(b[`hitsDiffPop:${q}`]),
    }])),
  };
}

const overall = summarize(scored, (p) => p.all, METHODS);
const byTertile = Object.fromEntries(TERTILES.map((t) => [t, summarize(scored, (p) => p.tert[t], t === 'low' ? [...METHODS, 'llmTail'] : METHODS)]));
const films = summarize(scored.filter((p) => p.kind !== 'series'), (p) => p.all, METHODS);
const series = summarize(scored.filter((p) => p.kind === 'series'), (p) => p.all, METHODS);
const afterRows = scored.filter((p) => p.laterDate >= CUTOFF);
const afterPositives = afterRows.reduce((s, p) => s + p.positives.length, 0);
const after = afterPositives >= 10 ? summarize(afterRows, (p) => p.all, METHODS) : { pairs: afterRows.length, positives: afterPositives, note: 'fewer than 10 positives: counts only' };
const before = summarize(scored.filter((p) => p.laterDate < CUTOFF), (p) => p.all, METHODS);

const H = (s, llmCmp) => Object.fromEntries(QLOO.map((q) => {
  const v = s.qlooVs?.[q];
  if (!v) return [q, null];
  return [q, llmCmp === 'tail'
    ? { holds: v.hitsMinusLlm.lo > 0, hitsMinusLlmTailLo: v.hitsMinusLlm.lo }
    : { holds: v.aucMinusPopularity.lo > 0 && v.hitsMinusLlm.lo > 0, aucMinusPopularityLo: v.aucMinusPopularity.lo, hitsMinusLlmLo: v.hitsMinusLlm.lo }];
}));
const hypotheses = {
  H1: H(overall),
  H2: H(byTertile.low, 'tail'),
  H3: after.qlooVs ? H(after) : 'not tested: fewer than 10 positives after the cutoff',
};

// Emerging artists (registered rule): Wikipedia views before vs after the LLM cutoff.
const wiki = new Wiki();
const posNames = [...new Set(scored.flatMap((p) => p.positives))];
const qids = new Map(pool.filter((a) => posNames.includes(a.name)).map((a) => [a.name, a.wikidata]));
const titles = await wiki.titlesFor([...qids.values()].filter(Boolean));
const meanDaily = (rows, from, to) => {
  let views = 0, days = 0;
  for (let m = from; m <= to; m = nextMonth(m)) {
    const [y, mo] = m.split('-').map(Number);
    days += new Date(Date.UTC(y, mo, 0)).getUTCDate();
    views += rows.find((r) => r.month === m)?.views || 0;
  }
  return views / days;
};
function nextMonth(m) { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; }
const emerging = new Map();
for (const n of posNames) {
  const t = titles.get(qids.get(n));
  if (!t) { emerging.set(n, { rose: true, why: 'no English Wikipedia article' }); continue; }
  const rows = await wiki.monthly(t, '2023-06', '2025-06');
  const pre = meanDaily(rows, '2023-06', '2024-05'), post = meanDaily(rows, '2024-07', '2025-06');
  emerging.set(n, { rose: pre < 0.25 * post, pre: +pre.toFixed(1), post: +post.toFixed(1) });
}
const risen = posNames.filter((n) => emerging.get(n)?.rose);
let emergingResult = { positives: risen.length, names: risen };
if (risen.length >= 10) {
  const rows = scored.map((p) => {
    const rp = p.positives.filter((n) => emerging.get(n)?.rose);
    if (!rp.length) return null;
    const universe = poolNames.filter((n) => !p.positives.includes(n) || rp.includes(n));
    const m = {};
    for (const k of METHODS) { const r = scoreRanking(universe, p.rank[k].filter((n) => universe.includes(n)), rp); m[k] = { auc: r.auc, hits: r.hits, positives: rp.length }; }
    return { franchise: p.franchise, m };
  }).filter(Boolean);
  emergingResult = { ...emergingResult, pooledAuc: Object.fromEntries(METHODS.map((k) => [k, r3(pooledAuc(rows.map((x) => x.m[k])))])) };
}

const summary = {
  at: new Date().toISOString(),
  registeredCommit: REGISTERED,
  pool: pool.length,
  topK: TOP_K,
  candidates: CANDIDATES.length,
  pairsScored: scored.length,
  positives: scored.reduce((s, p) => s + p.positives.length, 0),
  excluded,
  overall, byTertile, films, series, afterCutoff: after, beforeCutoff: before,
  emergingArtists: emergingResult,
  hypotheses,
  llm: { model: llm.model || config.openaiModel, status: llm.status, tailStatus: llmTail.status },
  perPair: scored.map((p) => ({
    id: p.id, kind: p.kind, franchise: p.franchise, later: p.later, laterDate: p.laterDate, signal: p.signal.query,
    sources: p.sources, repeatsRemoved: p.repeatsRemoved, positives: p.positives.length,
    positivesByTertile: Object.fromEntries(TERTILES.map((t) => [t, p.positives.filter((n) => tertileOf.get(n) === t).length])),
    methods: Object.fromEntries(Object.entries(p.all).map(([k, m]) => [k, { auc: r3(m.auc), hits: m.hits, hitNames: m.hitNames }])),
  })),
  usage: { qlooLive: client.http.stats.live - startLive, wikimediaLive: wiki.stats.live, openai: [llm.usage, llmTail.usage] },
};
fs.writeFileSync(path.join(ROOT, 'seal', 'backtest-v2.json'), JSON.stringify(summary, null, 2) + '\n');
fs.mkdirSync(config.privateDir, { recursive: true });
fs.writeFileSync(path.join(config.privateDir, `backtest-v2-${summary.at.slice(0, 10)}.json`), JSON.stringify({
  summary, positives: Object.fromEntries(scored.map((p) => [p.id, p.positives])), emerging: Object.fromEntries(emerging),
  llmPicks: llm.byTitle, llmTailPicks: llmTail.byTitle, tertiles: byTertile,
}, null, 1));

const fmt = (o) => (o ? `${o.value} [${o.lo}, ${o.hi}]` : '-');
console.log(`\nPairs scored ${scored.length}, positives ${summary.positives}, excluded ${excluded.length}`);
for (const [label, s] of [['ALL', overall], ['films+games', films], ['series', series], ['before cutoff', before], ['after cutoff', after], ...TERTILES.map((t) => [`tertile ${t}`, byTertile[t]])]) {
  console.log(`\n== ${label}: ${s.pairs} pairs, ${s.positives} positives`);
  if (!s.pooledAuc) { console.log(`   ${s.note || ''}`); continue; }
  for (const m of Object.keys(s.pooledAuc)) console.log(`   ${m.padEnd(14)} AUC ${fmt(s.pooledAuc[m])}   hits@50 ${fmt(s.hits[m])}`);
  for (const q of QLOO) console.log(`   ${q.padEnd(14)} AUC-pop ${fmt(s.qlooVs[q].aucMinusPopularity)}  AUC-llm ${fmt(s.qlooVs[q].aucMinusLlm)}  hits-${s.llmComparedWith} ${fmt(s.qlooVs[q].hitsMinusLlm)}`);
}
console.log('\nHypotheses:', JSON.stringify(hypotheses, null, 1));
console.log('Emerging artists:', JSON.stringify(emergingResult));
const cost = [llm.usage, llmTail.usage].filter(Boolean).reduce((s, u) => s + (u.inputTokens * 0.4 + u.outputTokens * 1.6) / 1e6, 0);
console.log(`Qloo live calls ${summary.usage.qlooLive}; Wikimedia live ${wiki.stats.live}; OpenAI about $${cost.toFixed(3)}`);
