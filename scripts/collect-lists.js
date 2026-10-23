// Build the backtest answer keys and the sealed titles' earlier lists from official or open sources
// (MusicBrainz web service, Netflix Tudum). No Qloo calls. Usage: npm run collect-lists
// Writes src/data/backtest_v2_lists.json and src/data/prior_lists.json (artist names and sources only).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.js';
import { MusicBrainz } from '../src/musicbrainz.js';
import { buildList } from '../src/answerkey.js';
import { CANDIDATES, SEALED_PRIOR } from '../src/data/backtest_v2_candidates.js';

const mb = new MusicBrainz();
const lists = {};
for (const c of CANDIDATES) {
  const later = await buildList(mb, c.laterSrc);
  const earlier = await buildList(mb, c.earlierSrc);
  lists[c.id] = { later, earlier };
  console.log(`${c.id.padEnd(20)} later ${String(later.credits.length).padStart(3)} credits${later.missing ? ' (NO LIST)' : ''}  earlier ${String(earlier.credits.length).padStart(3)}${earlier.missing ? ' (none)' : ''}`);
  for (const l of [...later.log.map((x) => `later: ${x}`), ...earlier.log.map((x) => `earlier: ${x}`)]) console.log(`    ${l}`);
}
fs.writeFileSync(path.join(ROOT, 'src', 'data', 'backtest_v2_lists.json'), JSON.stringify({ collectedAt: new Date().toISOString().slice(0, 10), lists }, null, 1) + '\n');

const prior = {};
for (const [id, src] of Object.entries(SEALED_PRIOR)) {
  const l = await buildList(mb, src);
  if (l.missing) { console.log(`prior ${id}: no lawful list`); continue; }
  prior[id] = { sources: l.used.map((u) => u.source), partial: true, artists: l.credits, log: l.log };
  console.log(`prior ${id}: ${l.credits.length} credits`);
}
fs.writeFileSync(path.join(ROOT, 'src', 'data', 'prior_lists.json'), JSON.stringify(prior, null, 1) + '\n');
console.log(`MusicBrainz requests: live ${mb.stats.live}, cached ${mb.stats.cached}`);
