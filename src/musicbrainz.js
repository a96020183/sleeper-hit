// MusicBrainz web service (open data). Used to build soundtrack answer keys for the backtest, and
// for the catalogue part of the quiet check (latest studio album, see src/quiet.js).
// Rules we follow (https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting): one request every
// 1.1 s or slower, a descriptive User-Agent, targeted lookups only (no crawling).
// Responses are cached under .private/cache/musicbrainz so a rerun makes no requests.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const UA = 'SleeperHit/0.1 (Qloo hackathon prototype; soundtrack backtest and catalogue check)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class MusicBrainz {
  constructor({ fetchImpl = fetch, cacheDir = path.join(config.privateDir, 'cache', 'musicbrainz'), gapMs = 1100 } = {}) {
    Object.assign(this, { fetchImpl, cacheDir, gapMs, last: 0, stats: { live: 0, cached: 0 } });
  }

  async get(pathAndQuery) {
    const url = `https://musicbrainz.org/ws/2/${pathAndQuery}${pathAndQuery.includes('?') ? '&' : '?'}fmt=json`;
    const f = path.join(this.cacheDir, crypto.createHash('sha256').update(url).digest('hex') + '.json');
    if (fs.existsSync(f)) { this.stats.cached++; return JSON.parse(fs.readFileSync(f, 'utf8')).body; }
    for (let attempt = 0; ; attempt++) {
      const wait = this.last + this.gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      const res = await this.fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      this.stats.live++;
      if (res.status === 503 && attempt < 3) { await sleep(3000 * (attempt + 1)); continue; }
      if (!res.ok && res.status !== 404) throw new Error(`MusicBrainz HTTP ${res.status} for ${url}`);
      const body = res.status === 404 ? null : await res.json(); // a 404 (nothing linked) is cached too
      fs.mkdirSync(this.cacheDir, { recursive: true });
      fs.writeFileSync(f, JSON.stringify({ url, fetchedAt: new Date().toISOString(), body }));
      return body;
    }
  }

  async soundtrackGroups(title) {
    const q = encodeURIComponent(`releasegroup:"${title}" AND secondarytype:soundtrack`);
    const body = await this.get(`release-group/?query=${q}&limit=25`);
    return (body?.['release-groups'] || []).map((g) => ({
      id: g.id, title: g.title, date: g['first-release-date'] || '', primary: g['primary-type'] || '', secondary: g['secondary-types'] || [],
      credit: (g['artist-credit'] || []).map((c) => c.name).join(' '), score: g.score,
    }));
  }

  // The official release in a group with the most tracks, with every track's artist credit.
  async biggestRelease(groupId) {
    const body = await this.get(`release?release-group=${groupId}&inc=media&limit=100`);
    const rels = (body?.releases || []).filter((r) => !r.status || r.status === 'Official');
    if (!rels.length) return null;
    const count = (r) => (r.media || []).reduce((s, m) => s + (m['track-count'] || 0), 0);
    rels.sort((a, b) => count(b) - count(a) || String(a.date || '9999').localeCompare(String(b.date || '9999')));
    const r = await this.get(`release/${rels[0].id}?inc=recordings+artist-credits`);
    const tracks = [];
    for (const m of r?.media || []) for (const t of m.tracks || []) {
      tracks.push({ title: t.title, artists: (t['artist-credit'] || []).map((c) => c.artist?.name || c.name) });
    }
    return { id: r.id, title: r.title, date: r.date || '', tracks };
  }

  // The MusicBrainz artist linked to a Wikidata id (Qloo carries the Wikidata id). Null if none.
  async artistForWikidata(qid) {
    if (!qid) return null;
    const body = await this.get(`url?resource=${encodeURIComponent(`https://www.wikidata.org/wiki/${qid.toUpperCase()}`)}&inc=artist-rels`);
    const a = (body?.relations || []).find((r) => r['target-type'] === 'artist' && r.artist?.id)?.artist;
    return a ? { id: a.id, name: a.name } : null;
  }

  // Every release group credited to the artist with primary type Album (any secondary types kept,
  // so the caller can drop compilations, live albums and the like). Pages of 100.
  // release-group-status=website-default leaves out groups whose releases are all bootleg,
  // promotional or pseudo-releases (the same groups the MusicBrainz artist page hides).
  async albumGroups(artistId) {
    const out = [];
    for (let offset = 0; ; offset += 100) {
      const body = await this.get(`release-group?artist=${artistId}&type=album&release-group-status=website-default&limit=100&offset=${offset}`);
      const groups = body?.['release-groups'] || [];
      for (const g of groups) out.push({ title: g.title, date: g['first-release-date'] || '', primary: g['primary-type'] || '', secondary: g['secondary-types'] || [] });
      if (!groups.length || offset + 100 >= (body['release-group-count'] || 0)) break;
    }
    return out;
  }
}
