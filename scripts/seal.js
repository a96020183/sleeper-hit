// Seal the forecast.
//   npm run seal                 dry run: files + hashes under .private/sealed/dryrun-<time>/ (nothing public)
//   npm run seal -- --final      also writes seal/hashes.json (public: hashes only)
// Set SEAL_PASSWORD to store the files encrypted. Keep the password private until unsealing.
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from '../src/config.js';
import { QlooClient } from '../src/qloo/client.js';
import { scorePool, ranksFile } from '../src/forecast.js';
import { writeSeal } from '../src/seal.js';
import { llmBaseline, similarTitlesBaseline } from '../src/baselines.js';
import { JUDGING } from '../src/data/windows.js';
import { TOP_K } from '../src/evaluate.js';

// Stated in the seal itself: the score was changed after the backtest, not before.
const SCORE_CHANGE = {
  now: "Qloo affinity + popularity rank blend: the average of each artist's rank by raw affinity (earlier title as signal) and its rank by Qloo popularity, ties by affinity. Decides the verdict.",
  before: 'Qloo excess affinity: affinity percentile inside 10 equal popularity bands. Still sealed in ranks.json (excessRank) and reported next to the blend, never used for the verdict.',
  changedOn: '2026-10-23',
  why: 'This score was changed after we saw the backtest (seal/backtest-v2.json). Of four registered Qloo uses, only the rank blend cleared the registered bar: pooled AUC 0.768 [0.700, 0.816] vs popularity 0.686, +10 [+3, +19] top-50 hits vs the LLM. The original score, excess affinity, reached 0.714 [0.635, 0.793] and did not clear it (+0.028 [-0.047, +0.141] vs popularity). Choosing the winner after the fact favours the blend; the settlement after release is the test it has not seen.',
};

const final = process.argv.includes('--final');
const allowPending = process.argv.includes('--allow-pending');
const client = new QlooClient();
const sealedAt = new Date().toISOString();
console.log(`Qloo mode: ${client.label}${final ? ', FINAL seal' : ', dry run'}`);
if (final && client.mode !== 'live') { console.error('A final seal must use live Qloo data.'); process.exit(1); }

const run = await scorePool(client, { log: (m) => console.log('  ' + m) });
const titles = Object.keys(run.titles);

const baselines = {
  sealedAt,
  popularity: { status: 'ready', rule: 'rank the pool by Qloo popularity, same order for every title', ranking: [...run.pool].sort((a, b) => b.popularity - a.popularity).map((a) => a.name) },
  llm: await llmBaseline(run.pool.map((a) => a.name), titles.map((id) => ({ id, title: run.titles[id].title, earlier: run.titles[id].signal }))),
  similarTitles: similarTitlesBaseline(run.pool, titles),
};
const pending = ['llm', 'similarTitles'].filter((k) => baselines[k].status !== 'ready');
if (pending.length) console.log(`Baselines still pending: ${pending.join(', ')}`);
if (final && pending.length && !allowPending) { console.error('Refusing a final seal with pending baselines (use --allow-pending to override).'); process.exit(1); }

const files = {
  'pool.json': { sealedAt, definition: { n: config.poolN, bands: config.poolBands, rule: 'the first N artists Qloo returns for filter.popularity.min=0.9, most popular first (Qloo paging skips some very popular artists, so this is not the complete top N)' }, artists: run.pool },
  'ranks.json': ranksFile(run, sealedAt),
  'baselines.json': baselines,
};
const stamp = sealedAt.replace(/[:.]/g, '-');
const dir = path.join(config.privateDir, 'sealed', `${final ? 'final' : 'dryrun'}-${stamp}`);
const password = process.env.SEAL_PASSWORD || '';
const hashes = writeSeal(dir, files, { password });
const labels = { 'pool.json': 'Pool list', 'ranks.json': 'Per-title ranks', 'baselines.json': 'Baseline predictions' };
const settlement = {
  how: "npm run settle, after a person adds each released title's public song list to src/data/new_soundtracks.js",
  positives: 'pool artists in the new list, minus artists the earlier title used and artists in trailers released before the seal',
  score: `per-title AUC over the pool and hits@${TOP_K}; pooled AUC = per-title AUC weighted by positives`,
  qlooScore: SCORE_CHANGE.now,
  scoreChange: SCORE_CHANGE,
  verdict: 'pass: pooled AUC >= 0.65 and above popularity, the LLM and similar titles; fail: <= 0.55 or not above popularity or the LLM; fewer than 10 positives: too few to count',
  unseal: 'names, ranks and band percentiles are published at the first settlement after winners are announced',
  finalSettle: JUDGING.finalSettle,
};
const summary = { sealedAt, mode: client.mode, encrypted: !!password, poolSize: run.pool.length, titles: titles.length, pendingBaselines: pending, settlement, files: hashes.map((h) => ({ ...h, label: labels[h.file] })) };
fs.writeFileSync(path.join(dir, 'hashes.json'), JSON.stringify(summary, null, 2));
for (const h of summary.files) console.log(`${h.label.padEnd(22)} ${h.sha256}`);
console.log(`Private files: ${path.relative(ROOT, dir)}${password ? ' (encrypted)' : ' (NOT encrypted: set SEAL_PASSWORD for the final seal)'}`);
if (final) {
  fs.mkdirSync(path.join(ROOT, 'seal'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'seal', 'hashes.json'), JSON.stringify(summary, null, 2));
  console.log('Public hashes written to seal/hashes.json');
}
