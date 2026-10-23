// Agent step "find": scan the pool for famous artists that are quiet now and that some open
// sequel window's audience loves beyond their popularity.
// Usage: npm run find-sleepers
//   Qloo: the pool and the five open doors (about 300 calls the first time, cached after).
//   Wikipedia: one Wikidata lookup per 50 artists and one page-view request per checked artist (cached).
// Rule: the best open door in the top 20% of the pool on the card score, well known = among the 500
// most popular in the pool (FAMOUS) (written down instead of judged by hand), and quiet by the
// Wikipedia rule in src/quiet.js (replaces Qloo trending). Ranked by best door.
// Card score since 2026-10-23: the affinity + popularity rank blend (src/scoring.js blendRanks),
// changed after the backtest. Until then it was the affinity percentile among the 100
// nearest-popularity pool artists; that number is still printed for comparison.
// Wikimedia allows about 10 anonymous page-view requests a minute, so only artists that pass the
// first two filters are checked, best door first.
// Output: a short table on the console; full details in .private/ (Qloo-derived, never public).
import fs from 'node:fs';
import path from 'node:path';
import { config, todayISO } from '../src/config.js';
import { QlooClient } from '../src/qloo/client.js';
import { WINDOWS } from '../src/data/windows.js';
import { percentileOf, blendRanks } from '../src/scoring.js';
import { evaluateTiming } from '../src/timing.js';
import { quietFromPageviews } from '../src/quiet.js';
import { wikiFor, pageviewsFor } from '../src/pipeline.js';

const PEERS = 100; // nearest-popularity peers inside the pool (old score, printed for comparison)
const DOOR_MIN = Number(process.env.DOOR_MIN || 80); // best open door at least this percentile (card score)
const FAMOUS = Number(process.env.FAMOUS || 500); // well known: popularity rank in the pool

const client = new QlooClient();
const wiki = wikiFor(client);
const today = todayISO();
const log = (m) => console.log(m);
log(`Qloo mode: ${client.label}`);
const pool = await client.buildPool(config.poolN);
log(`pool: ${pool.length}`);
pool.sort((a, b) => b.popularity - a.popularity);
const peersOf = (i) => {
  const lo = Math.max(0, Math.min(pool.length - PEERS, i - PEERS / 2));
  return pool.slice(lo, lo + PEERS);
};

const doors = WINDOWS.filter((w) => w.card);
const aff = {};
const blend = {};
for (const w of doors) {
  const sig = await client.resolve({ query: w.earlier.query, type: w.earlier.type, name: w.earlier.name || w.earlier.query, year: w.earlier.year });
  const m = await client.scoreArtists(sig.id, pool.map((a) => a.id));
  aff[w.id] = new Map([...m].map(([id, v]) => [id, v.affinity]));
  blend[w.id] = blendRanks(pool, aff[w.id]);
  log(`scored ${w.id}: ${m.size}`);
}

const open = doors.filter((w) => evaluateTiming(w, today).bucket === 'in-window');
const rows = pool.map((a, i) => {
  const peers = peersOf(i);
  const doorPct = {}, oldPct = {};
  for (const w of doors) {
    const vals = peers.map((p) => aff[w.id].get(p.id)).filter((v) => v !== undefined);
    oldPct[w.id] = aff[w.id].has(a.id) ? percentileOf(aff[w.id].get(a.id), vals) : null;
    doorPct[w.id] = blend[w.id].get(a.id)?.pct ?? null;
  }
  const best = open.map((w) => [w.id, doorPct[w.id]]).filter(([, v]) => v !== null).sort((x, y) => y[1] - x[1])[0] || [null, null];
  const bestRank = best[0] ? blend[best[0]].get(a.id).rank : null;
  const oldBest = open.map((w) => oldPct[w.id]).filter((v) => v !== null).sort((x, y) => y - x)[0] ?? null;
  return { name: a.name, wikidata: a.wikidata, popRank: i + 1, doorPct, oldPct, bestDoor: best[0], bestPct: best[1], bestRank, oldBestPct: oldBest, quiet: null };
});
const shortlist = rows.filter((r) => r.popRank <= FAMOUS && r.bestPct !== null && r.bestPct >= DOOR_MIN)
  .sort((x, y) => y.bestPct - x.bestPct || x.popRank - y.popRank);
log(`${shortlist.length} of the top ${FAMOUS} have an open door at ${DOOR_MIN} or higher. Checking Wikipedia page views...`);

// Wikipedia: titles from the Wikidata ids Qloo carries, then monthly views.
const titles = await wiki.titlesFor(shortlist.map((r) => r.wikidata));
let n = 0;
for (const r of shortlist) {
  const t = r.wikidata && titles.get(r.wikidata);
  if (!t) { r.quiet = 'no-page'; continue; }
  try {
    const q = quietFromPageviews(await pageviewsFor(wiki, t, today), today);
    Object.assign(r, q ? { page: t, quiet: q.quiet, ratio: q.ratio, peakRatio: q.peakRatio, peakMonth: q.peakMonth } : { page: t, quiet: 'short-history' });
  } catch (e) { r.quiet = 'error'; }
  if (++n % 25 === 0) log(`page views ${n}/${shortlist.length}`);
}
const checked = shortlist.filter((r) => typeof r.quiet === 'boolean');
const picks = checked.filter((r) => r.quiet);
fs.mkdirSync(config.privateDir, { recursive: true });
const out = path.join(config.privateDir, `sleepers-wiki-${client.mode}-${today}.json`);
fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), poolSize: pool.length, doorMin: DOOR_MIN, famous: FAMOUS, score: 'affinity + popularity rank blend', quietBasis: 'Wikipedia page views', shortlist: shortlist.map(({ wikidata, ...r }) => r) }, null, 1));
log(`\nQuiet by the Wikipedia rule: ${picks.length} of ${checked.length} checked (${shortlist.length - checked.length} without an English article or enough history). Best door first:`);
picks.forEach((r, i) => {
  if (i < 40 || r.name === 'The Clash') log(`${String(i + 1).padStart(3)}. pop ${String(r.popRank).padStart(4)}  ${r.name.padEnd(28)} 3m ${r.ratio}x  peak ${r.peakRatio}x ${r.peakMonth}  best ${r.bestDoor} #${r.bestRank} (${r.bestPct.toFixed(1)})  old ${r.oldBestPct === null ? '-' : Math.round(r.oldBestPct)}`);
});
for (const name of ['The Verve', 'Iggy Pop', 'Air Supply', 'Culture Club']) {
  const r = shortlist.find((x) => x.name === name) || rows.find((x) => x.name === name);
  if (r) log(`  ${name}: quiet ${r.quiet}, 3m ${r.ratio}x, peak ${r.peakRatio}x ${r.peakMonth}, best ${r.bestDoor} #${r.bestRank ?? '-'} (${r.bestPct === null ? '-' : r.bestPct.toFixed(1)})`);
}
log(`Qloo calls live ${client.http.stats.live}, cached ${client.http.stats.cached}; Wikimedia live ${wiki.stats.live}, cached ${wiki.stats.cached}`);
log(`Details (private): ${path.relative(process.cwd(), out)}`);
