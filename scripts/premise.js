// Key-day check 1: does excess affinity measure more than popularity?
// Usage: npm run premise            (uses QLOO_MODE / QLOO_API_KEY)
// Prints the verdict. Per-title numbers are written to .private/ only (they are Qloo-derived).
import fs from 'node:fs';
import path from 'node:path';
import { config, todayISO, ROOT } from '../src/config.js';
import { QlooClient } from '../src/qloo/client.js';
import { scorePool, premise } from '../src/forecast.js';
import { expectedPositives } from '../src/baselines.js';
import { WINDOWS, JUDGING } from '../src/data/windows.js';
import { evaluateTiming } from '../src/timing.js';

const client = new QlooClient();
console.log(`Qloo mode: ${client.label}`);
const run = await scorePool(client, { log: (m) => console.log('  ' + m) });
const p = premise(run);
const f = (v) => (v === null || v === undefined ? 'n/a' : v.toFixed(3));
console.log(`\nMedian Spearman(affinity, popularity): ${f(p.rho)}`);
console.log(`Median pairwise Kendall tau of excess-affinity ranks: ${f(p.medianTau)} over ${p.pairs.length} pairs`);
console.log(`Verdict: ${p.verdict.toUpperCase()}${p.why ? ` (${p.why})` : ''}`);
if (run.failures.length) console.log('Failed titles:', run.failures.map((x) => `${x.id}: ${x.error}`).join(' | '));
console.log(`Calls: live ${client.http.stats.live}, cached ${client.http.stats.cached}, monthly quota left ${client.http.monthRemaining ?? 'n/a'}`);
// Key-day check 2: is the sample big enough? Upper bound (repeat rate 0) per title in the judging period.
const ep = expectedPositives(run.pool);
const inJudging = (w) => { const t = evaluateTiming(w, todayISO()); return t.date && t.date.length === 10 && t.date >= JUDGING.start && t.date <= JUDGING.end; };
console.log('\nExpected positives (earlier-title artists x pool coverage, repeat rate 0 = upper bound):');
let tier1 = 0;
for (const w of WINDOWS.filter((x) => x.sealed)) {
  const r = ep[w.id];
  if (!r) continue;
  const j = inJudging(w);
  if (j) tier1 += r.expected;
  console.log(`  ${w.id.padEnd(18)} artists ${String(r.artists).padStart(3)}  in pool ${String(r.inPool).padStart(3)}  coverage ${(r.coverage * 100).toFixed(0).padStart(3)}%  expected ${r.expected.toFixed(1).padStart(5)}${r.partial ? '  (partial list)' : ''}${j ? '  [judging period]' : ''}`);
}
console.log(`  Judging-period titles, upper bound: ${tier1.toFixed(1)} (bar: 10)`);
const out = path.join(config.privateDir, `premise-${client.mode}-${todayISO()}.json`);
fs.mkdirSync(config.privateDir, { recursive: true });
fs.writeFileSync(out, JSON.stringify({ mode: client.mode, at: new Date().toISOString(), poolSize: run.pool.length, ...p, failures: run.failures }, null, 2));
console.log(`Details (private): ${path.relative(process.cwd(), out)}`);
if (client.mode === 'live' && p.rho !== null) {
  // Public summary for the Trust tab: aggregate statistics only, no per-artist values or ids.
  const summary = { at: new Date().toISOString(), mode: client.mode, poolSize: run.pool.length, titles: p.perTitle.length, medianSpearman: +p.rho.toFixed(3), medianTau: p.medianTau === null ? null : +p.medianTau.toFixed(3), verdict: p.verdict, why: p.why || '', expectedPositivesTier1UpperBound: +tier1.toFixed(1) };
  fs.mkdirSync(path.join(ROOT, 'seal'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'seal', 'premise.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log('Public summary: seal/premise.json');
}
