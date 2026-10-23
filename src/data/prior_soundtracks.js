// Artists used by each sealed title's earlier title. Used for (1) the "what similar titles used"
// baseline and (2) excluding repeat artists from positives at settlement. Not Qloo data.
//
// Sources: official or open data only (Netflix Tudum song lists, MusicBrainz soundtrack releases).
// Tunefind lists were removed on 2026-10-23 (its robots.txt blocks ClaudeBot) and are not used.
// Lists are filled by scripts/collect-lists.js; a title with no lawful list stays empty (source: null).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LABELS = {
  'black-doves-s2': 'Black Doves season 1',
  'gta-vi': 'GTA V',
  'sonic-4': 'Sonic the Hedgehog 3',
  'gxk-supernova': 'Godzilla x Kong: The New Empire',
  'yellowjackets-s4': 'Yellowjackets seasons 1-3',
  'empress-s3': 'The Empress seasons 1-2',
  'spider-verse-3': 'Across the Spider-Verse',
  'shrek-5': 'Shrek',
  'fast-x-2': 'Fast X',
  'ice-age-6': 'Ice Age: Collision Course',
  'angry-birds-3': 'The Angry Birds Movie 2',
  'north-of-north-s2': 'North of North season 1',
  'httyd-2-live': 'How to Train Your Dragon (2025)',
};

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'prior_lists.json');
const collected = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};

export const PRIOR_SOUNDTRACKS = Object.fromEntries(Object.entries(LABELS).map(([id, label]) => {
  const c = collected[id];
  return [id, c ? { label, source: c.sources.join(' '), partial: c.partial, artists: c.artists } : { label, source: null, partial: true, artists: [] }];
}));
