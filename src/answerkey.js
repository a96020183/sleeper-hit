// Answer keys for the backtest: which artists a title used, from official or open sources only.
// Rules are the ones registered in seal/backtest-v2-method.json ("inclusion").
//   MusicBrainz: release groups of the title; singles, anything titled "score", and releases with
//                fewer than 3 distinct credited artists (composer-only albums) are rejected and logged.
//   Tudum:       article text parsed by the format named for each page; prose mentions are added
//                only when recorded in src/data/backtest_v2_candidates.js with the sentence.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { normName } from './baselines.js';

const TUDUM_UA = 'Mozilla/5.0 (compatible; Claude-User; SleeperHit local backtest)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DROP = /^(various artists|\[unknown\]|\[traditional\]|\[no artist\]|.*\bcast\b.*)$/i;

export async function mbList(mb, groupIds = []) {
  const credits = [], used = [], log = [];
  for (const id of groupIds) {
    const browse = await mb.get(`release?release-group=${id}&inc=media+release-groups&limit=100`);
    const g = browse?.releases?.[0]?.['release-group'];
    const title = g?.title || '?';
    if (!g) { log.push(`${id}: no releases`); continue; }
    if (g['primary-type'] === 'Single') { log.push(`rejected single: ${title}`); continue; }
    if (/\bscore\b/i.test(title)) { log.push(`rejected score: ${title}`); continue; }
    const rel = await mb.biggestRelease(id);
    if (!rel) { log.push(`rejected, no official release: ${title}`); continue; }
    const names = [...new Set(rel.tracks.flatMap((t) => t.artists))].filter((n) => !DROP.test(n));
    if (names.length < 3) { log.push(`rejected, ${names.length} credited artist(s) (composer-only): ${title}`); continue; }
    credits.push(...names);
    used.push({ source: `https://musicbrainz.org/release/${rel.id}`, title: rel.title, tracks: rel.tracks.length, artists: names.length });
  }
  return { credits: [...new Set(credits)], used, log };
}

export function htmlToLines(html) {
  let s = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  s = s.replace(/<(br|\/p|\/li|\/h\d|\/div)[^>]*>/g, '\n').replace(/<[^>]+>/g, '');
  s = s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;|&rsquo;/g, '’').replace(/&nbsp;|&#160;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
  const lines = s.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const start = lines.findIndex((l) => l.startsWith('Link copied'));
  const end = lines.findIndex((l, i) => i > start && (l.startsWith('Related Tags') || l === 'My List'));
  return lines.slice(start < 0 ? 0 : start + 1, end < 0 ? lines.length : end);
}

const Q = '[“"]', QE = '[”"]';
const coverOf = (title) => [...title.matchAll(/\(([^()]+?) cover\)/gi)].map((m) => m[1]);
const originally = (s) => [...s.matchAll(/originally by ([^,()]+)/gi)].map((m) => m[1].trim());

// Parse one Tudum page. Returns credits (strings, split later at matching time).
export function parseTudum(lines, { format, seasons } = {}) {
  const out = [];
  let season = null;
  const inSeason = () => !seasons || seasons.includes(season);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if ((m = l.match(/^Season (\d+)$/))) { season = +m[1]; continue; }
    if ((m = l.match(/^Episode (\d)\d\d\b/i))) { season = +m[1]; continue; }
    if (format === 'songThenArtist' && (m = l.match(new RegExp(`^${Q}(.+?)${QE}\\s*(?:\\([^)]*\\)\\s*)?(.+)$`))) && inSeason()) {
      out.push(m[2], ...coverOf(m[1]));
    } else if (format === 'artistThenSong' && l.length < 160 && (m = l.match(new RegExp(`^([^“"]+?)\\s+${Q}(.+?)(?:${QE}|$)`))) && inSeason()) {
      out.push(m[1], ...coverOf(m[2]), ...originally(l));
    } else if (format === 'numberedList' && (m = l.match(/^\d+\.\s*(.+?)\s+[–-]\s+[“"]/))) {
      out.push(m[1]);
    } else if (format === 'songByArtist' && (m = l.match(new RegExp(`^${Q}(.+?)${QE} by (.+)$`)))) {
      out.push(m[2]);
    } else if (format === 'headingThenArtist' && l.length <= 80 && new RegExp(`^${Q}[^“”"]+${QE}$`).test(l)) {
      let j = i + 1;
      while (j < lines.length && /^(PHOTO BY|Episode|EPISODE)/.test(lines[j])) j++;
      const a = lines[j] || '';
      if (a.length > 90 || /^[“"]/.test(a)) continue;
      if ((m = a.match(/^\((.+)\) by (.+)$/))) out.push(m[1], m[2]);
      else if ((m = a.match(/^By (.+)$/i))) out.push(m[1]);
      else {
        const inner = a.match(/\((?:covered by|cover by) ([^)]+)\)/i);
        const base = a.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
        out.push(base);
        if (inner && !/^cast$/i.test(inner[1].trim())) out.push(inner[1].trim());
      }
    }
  }
  return out.map((s) => s.trim()).filter((s) => s && !DROP.test(s));
}

export async function tudumList(sources = []) {
  const credits = [], used = [];
  const dir = path.join(config.privateDir, 'cache', 'tudum');
  for (const src of sources) {
    const slug = src.url.split('/').pop();
    const file = path.join(dir, `${slug}.html`);
    if (!fs.existsSync(file)) {
      await sleep(3000);
      const res = await fetch(src.url, { headers: { 'User-Agent': TUDUM_UA } });
      if (!res.ok) throw new Error(`Tudum HTTP ${res.status} for ${src.url}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, await res.text());
    }
    const parsed = src.format === 'none' ? [] : parseTudum(htmlToLines(fs.readFileSync(file, 'utf8')), src);
    credits.push(...parsed, ...(src.named?.artists || []));
    used.push({ source: src.url, format: src.format, seasons: src.seasons || null, parsed: parsed.length, named: src.named?.artists?.length || 0 });
  }
  return { credits: [...new Set(credits)], used, log: [] };
}

export async function buildList(mb, src = {}) {
  if (src.none) return { credits: [], used: [], log: [src.none], missing: true };
  const a = src.mb ? await mbList(mb, src.mb) : { credits: [], used: [], log: [] };
  const b = src.tudum ? await tudumList(src.tudum) : { credits: [], used: [], log: [] };
  const log = [...a.log, ...b.log, ...(src.rejectedByHand || []).map((r) => `rejected by hand ${r.id}: ${r.why}`)];
  return { credits: [...new Set([...a.credits, ...b.credits])], used: [...a.used, ...b.used], log, missing: !a.used.length && !b.used.length };
}

// Registered matching rule: a credit is matched whole first; only if the whole credit is not a pool
// name is it split on feat./ft./featuring/x/&/with/commas (never on "and").
export function creditsInPool(credits, poolNames) {
  const index = new Map(poolNames.map((n) => [normName(n), n]));
  const hit = new Set();
  for (const c of credits) {
    const whole = index.get(normName(c));
    if (whole) { hit.add(whole); continue; }
    for (const part of c.split(/\s+(?:feat\.?|ft\.?|featuring|x|&|with)\s+|,\s*/i)) {
      const p = index.get(normName(part));
      if (p) hit.add(p);
    }
  }
  return [...hit];
}
