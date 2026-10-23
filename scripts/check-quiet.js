// Check the Wikipedia quiet rule (src/quiet.js) on the demo artists today, and on three known
// wake-ups as of a date just after the event. A rule that calls those three "quiet" is broken.
// Usage: npm run check:quiet      (Wikimedia only, no Qloo calls)
// Writes seal/quiet-check.json (Wikipedia page views are public data).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, todayISO } from '../src/config.js';
import { Wiki, addMonths } from '../src/wiki.js';
import { quietFromPageviews, QUIET_RULE } from '../src/quiet.js';
import { pageviewsFor } from '../src/pipeline.js';
import { ARTISTS } from '../src/data/artists.js';

const KNOWN_WAKE_UPS = [
  { page: 'Kate Bush', asOf: '2022-09-01', eventMonth: '2022-05', event: '"Running Up That Hill" in Stranger Things 4, May 2022' },
  { page: 'Tom Petty', asOf: '2024-01-15', eventMonth: '2023-12', event: '"Love Is a Long Road" in the GTA VI trailer, Dec 5 2023' },
  { page: 'The Pointer Sisters', asOf: '2025-07-01', eventMonth: '2025-05', event: '"Hot Together" in GTA VI trailer 2, May 6 2025' },
];

const wiki = new Wiki();
const today = todayISO();
const pick = (q) => (q ? { quiet: q.quiet, ratio: q.ratio, peakRatio: q.peakRatio, peakMonth: q.peakMonth, window: q.window, noWake: q.noWake, notRising: q.notRising } : null);

const demo = [];
for (const a of Object.values(ARTISTS)) {
  const q = quietFromPageviews(await pageviewsFor(wiki, a.wikipedia, today), today);
  demo.push({ artist: a.name, page: a.wikipedia, asOf: today, ...pick(q) });
}
const controls = [];
for (const k of KNOWN_WAKE_UPS) {
  const q = quietFromPageviews(await pageviewsFor(wiki, k.page, k.asOf), k.asOf);
  // caught: not quiet; peakIsEvent: the busiest month is the event month or the one after
  controls.push({ ...k, ...pick(q), caught: q ? !q.quiet : null, peakIsEvent: q ? q.peakMonth === k.eventMonth || q.peakMonth === addMonths(k.eventMonth, 1) : null });
}
const summary = { at: new Date().toISOString(), source: 'Wikimedia Pageviews API, en.wikipedia, all-access, agent=user, monthly', rule: QUIET_RULE, demo, knownWakeUps: controls };
fs.writeFileSync(path.join(ROOT, 'seal', 'quiet-check.json'), JSON.stringify(summary, null, 2) + '\n');
for (const d of demo) console.log(`${d.artist.padEnd(14)} ${d.quiet ? 'QUIET' : 'not quiet'}  last 3 months ${d.ratio}x, busiest month ${d.peakRatio}x (${d.peakMonth})`);
for (const c of controls) console.log(`${c.page.padEnd(20)} as of ${c.asOf}: ${c.caught ? (c.peakIsEvent ? 'caught, peak = event' : 'not quiet, but the peak is another month') : 'MISSED'}  last 3 months ${c.ratio}x, busiest ${c.peakRatio}x (${c.peakMonth})  [${c.event}]`);
console.log(`Wikimedia live ${wiki.stats.live}, cached ${wiki.stats.cached}`);
