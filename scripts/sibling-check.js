// Appendix check: do closely related titles get similar artist rankings from Qloo (and from an LLM)
// compared with unrelated pairs? Method: seal/sibling-check-method.json, registered in commit 8893210
// before this ran. Usage: node scripts/sibling-check.js   Public output: seal/sibling-check.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { config, ROOT } from '../src/config.js';
import { QlooClient } from '../src/qloo/client.js';
import { bandPercentiles, spearman } from '../src/scoring.js';
import { mulberry32 } from '../src/evaluate.js';

const REGISTERED = '8893210';
const FILE = 'seal/sibling-check-method.json';
const reg = execFileSync('git', ['show', `${REGISTERED}:${FILE}`], { cwd: ROOT, encoding: 'utf8' });
if (reg.replace(/\r\n/g, '\n') !== fs.readFileSync(path.join(ROOT, FILE), 'utf8').replace(/\r\n/g, '\n')) { console.error('Method changed since registration. Refusing to run.'); process.exit(1); }
const method = JSON.parse(reg);
const LIVE_CAP = 148; // 1,490 minus the 1,342 live calls the backtest used in this task

const M = 'urn:entity:movie', G = 'urn:entity:videogame', T = 'urn:entity:tv_show';
// Same resolve requests as the backtest and the sealed forecast, so cached signals cost nothing.
const SPEC = {
  'Twilight (2008)': { query: 'Twilight', type: M, year: '2008' },
  'The Twilight Saga: New Moon (2009)': { query: 'The Twilight Saga: New Moon', type: M, year: '2009' },
  'The Twilight Saga: Eclipse (2010)': { query: 'The Twilight Saga: Eclipse', type: M, year: '2010' },
  'The Twilight Saga: Breaking Dawn - Part 1 (2011)': { query: 'The Twilight Saga: Breaking Dawn - Part 1', type: M, year: '2011', names: ['The Twilight Saga: Breaking Dawn - Part 1', 'The Twilight Saga: Breaking Dawn – Part 1', 'The Twilight Saga: Breaking Dawn Part 1'] },
  'The Hunger Games (2012)': { query: 'The Hunger Games', type: M, year: '2012' },
  'The Hunger Games: Catching Fire (2013)': { query: 'The Hunger Games: Catching Fire', type: M, year: '2013' },
  'Fifty Shades of Grey (2015)': { query: 'Fifty Shades of Grey', type: M, year: '2015' },
  'Fifty Shades Darker (2017)': { query: 'Fifty Shades Darker', type: M, year: '2017' },
  'Guardians of the Galaxy (2014)': { query: 'Guardians of the Galaxy', type: M, year: '2014' },
  'Guardians of the Galaxy Vol. 2 (2017)': { query: 'Guardians of the Galaxy Vol. 2', type: M, year: '2017', names: ['Guardians of the Galaxy Vol. 2', 'Guardians of the Galaxy Volume 2'] },
  'Deadpool (2016)': { query: 'Deadpool', type: M, year: '2016' },
  'Deadpool 2 (2018)': { query: 'Deadpool 2', type: M, year: '2018' },
  'Spider-Man: Into the Spider-Verse (2018)': { query: 'Spider-Man: Into the Spider-Verse', type: M, year: '2018' },
  'Spider-Man: Across the Spider-Verse (2023)': { query: 'Spider-Man: Across the Spider-Verse', type: M, year: '2023' },
  'Furious 7 (2015)': { query: 'Furious 7', type: M, year: '2015' },
  'F9 (2021)': { query: 'F9', type: M, year: '2021', names: ['F9', 'F9: The Fast Saga'] },
  'Fast X (2023)': { query: 'Fast X', type: M, year: '2023' },
  'Sonic the Hedgehog 2 (2022)': { query: 'Sonic the Hedgehog 2', type: M, year: '2022' },
  'Sonic the Hedgehog 3 (2024)': { query: 'Sonic the Hedgehog 3', type: M, year: '2024' },
  'Godzilla vs. Kong (2021)': { query: 'Godzilla vs. Kong', type: M, year: '2021' },
  'Godzilla x Kong: The New Empire (2024)': { query: 'Godzilla x Kong: The New Empire', type: M, year: '2024' },
  'The Angry Birds Movie (2016)': { query: 'The Angry Birds Movie', type: M, year: '2016' },
  'The Angry Birds Movie 2 (2019)': { query: 'The Angry Birds Movie 2', type: M, year: '2019' },
  'Ice Age: Continental Drift (2012)': { query: 'Ice Age: Continental Drift', type: M, year: '2012' },
  'Ice Age: Collision Course (2016)': { query: 'Ice Age: Collision Course', type: M, year: '2016' },
  'Bad Boys for Life (2020)': { query: 'Bad Boys for Life', type: M, year: '2020' },
  'Twister (1996)': { query: 'Twister', type: M, year: '1996' },
  'Black Panther (2018)': { query: 'Black Panther', type: M, year: '2018' },
  'Shrek (2001)': { query: 'Shrek', type: M, year: '2001' },
  'How to Train Your Dragon (2025)': { query: 'How to Train Your Dragon', type: M, year: '2025' },
  'Grand Theft Auto IV (2008)': { query: 'Grand Theft Auto IV', type: G, year: '2008' },
  'Grand Theft Auto V (2013)': { query: 'Grand Theft Auto V', type: G, year: '2014' },
  'Red Dead Redemption 2 (2018)': { query: 'Red Dead Redemption 2', type: G, year: '2018', new: true },
  'Stranger Things (2016)': { query: 'Stranger Things', type: T, year: '2016' },
  'Wednesday (2022)': { query: 'Wednesday', type: T, year: '2022' },
  'Bridgerton (2020)': { query: 'Bridgerton', type: T, year: '2020' },
  'The Empress (2022)': { query: 'The Empress', type: T, year: '2022' },
  'The Gilded Age (2022)': { query: 'The Gilded Age', type: T, year: '2022', new: true },
  'Outer Banks (2020)': { query: 'Outer Banks', type: T, year: '2020' },
  'Nobody Wants This (2024)': { query: 'Nobody Wants This', type: T, year: '2024' },
  'BEEF (2023)': { query: 'Beef', type: T, year: '2023', names: ['Beef', 'BEEF'] },
  'Black Doves (2024)': { query: 'Black Doves', type: T, year: '2024' },
  'Yellowjackets (2021)': { query: 'Yellowjackets', type: T, year: '2021' },
  'North of North (2025)': { query: 'North of North', type: T, year: '2025' },
};
const FRANCHISE = (t) => {
  const s = t.toLowerCase();
  for (const k of ['twilight', 'hunger games', 'fifty shades', 'guardians', 'deadpool', 'spider-verse', 'sonic', 'godzilla', 'angry birds', 'ice age', 'grand theft auto']) if (s.includes(k)) return k;
  if (/^(furious 7|f9|fast x)/.test(s)) return 'fast';
  return t;
};
const yearOf = (t) => +t.match(/\((\d{4})\)/)[1];

const client = new QlooClient();
const start = client.http.stats.live;
const pool = await client.buildPool(config.poolN);
const poolNames = pool.map((a) => a.name);
const titles = [...method.signals.films, ...method.signals.games, ...method.signals.series];
const rank = {}, skipped = [];
for (const t of titles) {
  const s = SPEC[t];
  if (s.new && client.http.stats.live - start + 64 > LIVE_CAP) { skipped.push({ title: t, why: 'Qloo budget' }); continue; }
  let sig = null;
  for (const name of s.names || [s.query]) for (const year of [s.year, undefined]) { if (!sig) { try { sig = await client.resolve({ query: name, type: s.type, name, year }); } catch { /* next */ } } }
  if (!sig) { skipped.push({ title: t, why: 'not resolved' }); continue; }
  const aff = await client.scoreArtists(sig.id, pool.map((a) => a.id));
  const A = new Map([...aff].map(([id, v]) => [id, v.affinity]));
  const bands = bandPercentiles(pool, A, config.poolBands);
  const sc = pool.filter((a) => A.has(a.id));
  rank[t] = {
    qlooRaw: [...sc].sort((x, y) => A.get(y.id) - A.get(x.id)).map((a) => a.name),
    qlooExcess: [...sc].sort((x, y) => bands.get(y.id).pct - bands.get(x.id).pct || A.get(y.id) - A.get(x.id)).map((a) => a.name),
  };
  console.log(`${t.padEnd(50)} scored ${sc.length} (live so far ${client.http.stats.live - start})`);
}

// LLM: registered prompt, cached privately by request.
const usage = { calls: 0, cached: 0, inputTokens: 0, outputTokens: 0 };
const cacheDir = path.join(config.privateDir, 'cache', 'openai');
for (const t of Object.keys(rank)) {
  const request = { model: config.openaiModel, temperature: 0, response_format: { type: 'json_object' }, messages: [
    { role: 'system', content: 'You predict music licensing. Answer with JSON {"artists": [..]} using names copied exactly from the list.' },
    { role: 'user', content: `Title: ${t}. From this list, pick the 50 artists whose songs best fit this title's audience, most likely first.\n\n${poolNames.join('\n')}` },
  ] };
  const f = path.join(cacheDir, crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex') + '.json');
  let body;
  if (fs.existsSync(f)) { body = JSON.parse(fs.readFileSync(f, 'utf8')); usage.cached++; }
  else {
    const res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openaiKey}` }, body: JSON.stringify(request) });
    if (!res.ok) { console.error(`OpenAI HTTP ${res.status}`); process.exit(1); }
    body = await res.json();
    usage.calls++; usage.inputTokens += body.usage?.prompt_tokens || 0; usage.outputTokens += body.usage?.completion_tokens || 0;
    fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(f, JSON.stringify(body));
  }
  let picks = [];
  try { picks = JSON.parse(body.choices[0].message.content).artists || []; } catch { picks = []; }
  const allowed = new Set(poolNames);
  rank[t].llm = [...new Set(picks.filter((n) => allowed.has(n)))].slice(0, 50);
}

const jac = (a, b) => { const A = new Set(a.slice(0, 50)), B = new Set(b.slice(0, 50)); let i = 0; for (const x of A) if (B.has(x)) i++; return A.size + B.size - i ? i / (A.size + B.size - i) : null; };
const rho = (a, b) => { const pa = new Map(a.map((n, i) => [n, i])), pb = new Map(b.map((n, i) => [n, i])); const common = a.filter((n) => pb.has(n)); return spearman(common.map((n) => pa.get(n)), common.map((n) => pb.get(n))); };
const have = Object.keys(rank);
const sibKey = new Set(method.siblingPairs.map(([a, b]) => [a, b].sort().join('|')));
const siblings = method.siblingPairs.filter(([a, b]) => rank[a] && rank[b]);
const randoms = [];
for (let i = 0; i < have.length; i++) for (let j = i + 1; j < have.length; j++) {
  const [a, b] = [have[i], have[j]];
  if (sibKey.has([a, b].sort().join('|')) || FRANCHISE(a) === FRANCHISE(b)) continue;
  randoms.push([a, b]);
}
const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
const results = {};
for (const m of ['qlooRaw', 'qlooExcess', 'llm']) {
  const sj = siblings.map(([a, b]) => jac(rank[a][m], rank[b][m]));
  const rj = randoms.map(([a, b]) => jac(rank[a][m], rank[b][m]));
  const sMean = mean(sj), rMean = mean(rj);
  const rand = mulberry32(20261023);
  let ge = 0;
  for (let r = 0; r < 10000; r++) {
    const idx = new Set(); while (idx.size < sj.length) idx.add(Math.floor(rand() * rj.length));
    if (mean([...idx].map((k) => rj[k])) >= sMean) ge++;
  }
  const p = (ge + 1) / 10001;
  const ratio = rMean ? sMean / rMean : null;
  const yd = randoms.map(([a, b]) => Math.abs(yearOf(a) - yearOf(b)));
  const out = {
    siblingMeanJaccard: +sMean.toFixed(4), randomMeanJaccard: +rMean.toFixed(4), ratio: ratio === null ? null : +ratio.toFixed(2), p: +p.toFixed(4),
    pass: ratio !== null && ratio >= 3 && p < 0.01,
    yearConfoundSpearman: +spearman(yd, rj).toFixed(3),
    perSibling: siblings.map(([a, b], i) => ({ a, b, jaccard50: +sj[i].toFixed(3) })),
  };
  if (m !== 'llm') {
    out.siblingMeanSpearman = +mean(siblings.map(([a, b]) => rho(rank[a][m], rank[b][m]))).toFixed(3);
    out.randomMeanSpearman = +mean(randoms.map(([a, b]) => rho(rank[a][m], rank[b][m]))).toFixed(3);
  }
  results[m] = out;
  console.log(`${m.padEnd(11)} sibling J@50 ${out.siblingMeanJaccard}  random ${out.randomMeanJaccard}  ratio ${out.ratio}  p ${out.p}  pass ${out.pass}  year-confound rho ${out.yearConfoundSpearman}${out.siblingMeanSpearman !== undefined ? `  spearman sib ${out.siblingMeanSpearman} vs random ${out.randomMeanSpearman}` : ''}`);
}
const summary = { at: new Date().toISOString(), registeredCommit: REGISTERED, signals: have.length, siblingPairs: siblings.length, randomPairs: randoms.length, skipped, results,
  usage: { qlooLive: client.http.stats.live - start, openai: usage } };
fs.writeFileSync(path.join(ROOT, 'seal', 'sibling-check.json'), JSON.stringify(summary, null, 2) + '\n');
const cost = (usage.inputTokens * 0.4 + usage.outputTokens * 1.6) / 1e6;
console.log(`Skipped: ${JSON.stringify(skipped)}. Qloo live ${summary.usage.qlooLive}; OpenAI ${usage.calls} calls, about $${cost.toFixed(3)}`);
