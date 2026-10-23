// Key-day check: can Qloo /v2/trending tell whether an artist is quiet right now?
// Usage: npm run check:trending        (live Qloo; about 150 calls the first time, cached after)
//
// Pulls the weekly trending series in five half-year windows for the four demo artists, five
// equally popular peers of each, and one known wake-up (Tom Petty: GTA VI trailer 1, Dec 5 2023).
// Writes details to .private/ and an aggregate summary (counts and dates only, no Qloo values)
// to seal/trending-check.json for the Trust tab.
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from '../src/config.js';
import { QlooClient, ARTIST } from '../src/qloo/client.js';
import { ARTISTS } from '../src/data/artists.js';
import { spearman, median } from '../src/scoring.js';

const WINDOWS = [
  ['2023-09-01', '2024-02-29'],
  ['2024-03-01', '2024-08-31'],
  ['2024-09-01', '2025-02-28'],
  ['2025-03-01', '2025-10-16'],
  ['2025-10-17', '2026-10-22'],
];
const PEERS_EACH = 5;
const CONTROL = { name: 'Tom Petty', event: '2023-12-05', what: 'GTA VI trailer 1 used "Love Is a Long Road"' };

const client = new QlooClient();
if (client.mode !== 'live') { console.error('Needs the live Qloo key.'); process.exit(1); }

const subjects = [];
for (const a of Object.values(ARTISTS)) {
  const e = await client.resolve({ query: a.name, type: ARTIST });
  subjects.push({ name: e.name, id: e.id, role: 'demo' });
  const band = await client.peerBand(e);
  const peers = band.filter((b) => b.id !== e.id)
    .sort((x, y) => Math.abs(x.popularity - e.popularity) - Math.abs(y.popularity - e.popularity)).slice(0, PEERS_EACH);
  for (const p of peers) subjects.push({ name: p.name, id: p.id, role: `peer of ${e.name}` });
}
const ctl = await client.resolve({ query: CONTROL.name, type: ARTIST });
subjects.push({ name: ctl.name, id: ctl.id, role: 'known wake-up' });

const rows = [];
for (const s of subjects) {
  const perWindow = [];
  for (const [start, end] of WINDOWS) {
    const t = await client.trending(s.id, start, end);
    const ranks = t.map((r) => Number(r.population_rank));
    perWindow.push({
      start, end, points: t.length,
      distinct: new Set(ranks).size,
      moving: t.some((r) => Number(r.population_rank_velocity) !== 0),
      first: t.length ? t[t.length - 1].date : null,
      last: t.length ? t[0].date : null,
      series: t.map((r) => ({ date: r.date, rank: Number(r.population_rank) })),
    });
  }
  rows.push({ ...s, perWindow });
}

// Per window: how many series answer, and how many change at all.
const byWindow = WINDOWS.map(([start, end], i) => {
  const w = rows.map((r) => r.perWindow[i]);
  const answered = w.filter((x) => x.points > 0);
  return {
    start, end,
    series: w.length,
    answered: answered.length,
    changing: answered.filter((x) => x.distinct > 1).length,
    firstDate: answered.map((x) => x.first).sort()[0] || null,
    lastDate: answered.map((x) => x.last).sort().slice(-1)[0] || null,
  };
});

// Does today's (flat) value keep the order of the last real values (Dec 2024)?
const pairs = rows.map((r) => {
  const real = r.perWindow[2].series.filter((p) => p.date <= '2024-12-31');
  const now = r.perWindow[4].series;
  return real.length && now.length ? [real[0].rank, now[0].rank] : null;
}).filter(Boolean);
const keepsOrder = pairs.length >= 5 ? spearman(pairs.map((p) => p[0]), pairs.map((p) => p[1])) : null;

// Known wake-up: does the series show the event?
const ctlRow = rows.find((r) => r.role === 'known wake-up');
const ctlSeries = ctlRow.perWindow[0].series;
let control = { ...CONTROL, found: false };
if (ctlSeries.length) {
  const best = [...ctlSeries].sort((a, b) => a.rank - b.rank)[0];
  const med = median(ctlSeries.map((p) => p.rank));
  const days = Math.round((Date.parse(best.date) - Date.parse(CONTROL.event)) / 86400000);
  control = { ...CONTROL, found: true, peakWeek: best.date, daysFromEvent: days, foldVsMedian: +(med / best.rank).toFixed(2) };
}

const summary = {
  at: new Date().toISOString(),
  endpoint: '/v2/trending (filter.type=urn:entity:artist, weekly series)',
  artists: rows.length,
  demoArtists: rows.filter((r) => r.role === 'demo').map((r) => r.name),
  windows: byWindow,
  flatNow: { series: byWindow[4].answered, changing: byWindow[4].changing },
  todayKeepsDec2024Order: keepsOrder === null ? null : +keepsOrder.toFixed(2),
  knownWakeUp: control,
  verdict: byWindow[4].changing === 0 ? 'not usable for "quiet now": every series since Oct 17 2025 holds one repeated value' : 'usable',
};

fs.mkdirSync(config.privateDir, { recursive: true });
fs.writeFileSync(path.join(config.privateDir, `trending-check-${summary.at.slice(0, 10)}.json`), JSON.stringify({ summary, rows }, null, 1));
fs.writeFileSync(path.join(ROOT, 'seal', 'trending-check.json'), JSON.stringify(summary, null, 2) + '\n');

for (const w of byWindow) console.log(`${w.start}..${w.end}  answered ${w.answered}/${w.series}  changing ${w.changing}  dates ${w.firstDate || '-'}..${w.lastDate || '-'}`);
console.log(`Today's value vs last real value (Dec 2024), Spearman over ${pairs.length} artists: ${keepsOrder?.toFixed(2)}`);
console.log(`Known wake-up ${CONTROL.name}: ${control.found ? `peak week ${control.peakWeek} (${control.daysFromEvent} days from the event), ${control.foldVsMedian}x the median rank` : 'no data'}`);
for (const r of rows.filter((x) => x.role === 'demo')) console.log(`  ${r.name.padEnd(14)} ${r.perWindow.map((w) => `${w.points}/${w.distinct}`).join('  ')}   (points/distinct per window)`);
console.log(`Verdict: ${summary.verdict}`);
console.log(`Calls: live ${client.http.stats.live}, cached ${client.http.stats.cached}, month left ${client.http.monthRemaining ?? 'n/a'}`);
