// Qloo client. One interface, two transports:
//   live  -> https://hackathon.api.qloo.com with the X-Api-Key header (default when QLOO_API_KEY is set)
//   mock  -> offline stand-in (no key, or QLOO_MODE=mock). Never a silent fallback: if a live call
//            fails, the error is shown; switching to mock is an explicit setting.
import path from 'node:path';
import { config } from '../config.js';
import { QlooHttp, QlooError } from './http.js';
import { makeMockFetch } from './mock.js';
import { wikidataOf } from '../wiki.js';

export const ARTIST = 'urn:entity:artist';

export class QlooClient {
  constructor({ mode = config.qlooMode, fetchImpl, cacheRoot = path.join(config.privateDir, 'cache') } = {}) {
    if (mode === 'live' && !config.qlooKey) throw new QlooError('QLOO_MODE=live but QLOO_API_KEY is not set.', 0, 'NO_KEY');
    this.mode = mode === 'live' ? 'live' : 'mock';
    this.cacheRoot = cacheRoot;
    this.http = new QlooHttp({
      base: this.mode === 'live' ? config.qlooBase : 'https://mock.qloo.invalid',
      key: this.mode === 'live' ? config.qlooKey : 'MOCK',
      cacheDir: path.join(cacheRoot, this.mode),
      reqPerSec: this.mode === 'live' ? config.qlooReqPerSec : 1000,
      monthlyFloor: config.qlooMonthlyFloor,
      fetchImpl: fetchImpl || (this.mode === 'live' ? fetch : makeMockFetch()),
      label: this.mode === 'live' ? 'qloo-live' : 'qloo-mock',
    });
  }

  get label() { return this.mode === 'live' ? 'LIVE' : 'MOCK'; }

  async search(query, type, take = 5) {
    const body = await this.http.get('/search', { query, types: type, take });
    return (Array.isArray(body.results) ? body.results : []).map((e) => ({
      id: e.entity_id, name: e.name, popularity: e.popularity, disambiguation: e.disambiguation || '', subtype: e.subtype, wikidata: wikidataOf(e),
    }));
  }

  // Resolve a title or artist by name. Only an exact (case-insensitive) name match, optionally with
  // the expected year in the disambiguation, is accepted. Anything else is reported, not guessed.
  async resolve({ query, type, name = query, year }) {
    const hits = await this.search(query, type, 5);
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const match = hits.find((h) => norm(h.name) === norm(name) && (!year || String(h.disambiguation).includes(String(year))));
    if (!match) {
      throw new QlooError(`No exact Qloo match for "${name}"${year ? ` (${year})` : ''}. Candidates: ${hits.map((h) => `${h.name} [${h.disambiguation}]`).join('; ') || 'none'}`, 0, 'NEEDS_INPUT');
    }
    return match;
  }

  // Score a list of artist ids against one signal entity. Affinity depends on the signal, not on
  // the candidate set (measured by the Taste Atlas team, and re-checked here on key day), so the
  // pool can be scored in chunks and stay on one scale.
  async scoreArtists(signalId, artistIds) {
    const out = new Map();
    const chunk = Math.max(1, Math.min(50, config.qlooChunk));
    for (let i = 0; i < artistIds.length; i += chunk) {
      const ids = artistIds.slice(i, i + chunk);
      const body = await this.http.get('/v2/insights', {
        'filter.type': ARTIST,
        'signal.interests.entities': signalId,
        'filter.results.entities': ids.join(','),
        take: ids.length,
      });
      for (const e of body?.results?.entities || []) {
        const a = e?.query?.affinity;
        if (typeof a === 'number') out.set(e.entity_id, { affinity: a, popularity: e.popularity, name: e.name });
      }
    }
    return out; // ids missing from the map were not scored by Qloo (low data)
  }

  async popularityPage({ min, max, page }) {
    const params = { 'filter.type': ARTIST, 'filter.popularity.min': min, take: 50, page };
    if (max !== undefined) params['filter.popularity.max'] = max;
    const body = await this.http.get('/v2/insights', params);
    return (body?.results?.entities || []).map((e) => ({ id: e.entity_id, name: e.name, popularity: e.popularity, wikidata: wikidataOf(e) }));
  }

  // Pool = the first N artists Qloo returns for popularity >= 0.9 (they come back most popular first).
  // Checked 2026-10-23: the paging skips some very popular artists (Drake, Metro Boomin), so this is
  // not the complete top N. The definition is stated that way everywhere.
  async buildPool(n = config.poolN) {
    const pool = [];
    const seen = new Set();
    for (let page = 1; pool.length < n && page <= Math.ceil(n / 50) + 5; page++) {
      const rows = await this.popularityPage({ min: 0.9, page });
      if (!rows.length) break;
      for (const r of rows) if (!seen.has(r.id) && pool.length < n) { seen.add(r.id); pool.push(r); }
    }
    return pool;
  }

  // Peer band: the `size` artists closest in Qloo popularity to the given artist (the artist included).
  async peerBand(artist, size = config.peerBandSize) {
    let delta = 0.0002;
    let rows = [];
    for (let tries = 0; tries < 6; tries++) {
      rows = [];
      const min = +(artist.popularity - delta).toFixed(6);
      const max = +(artist.popularity + delta).toFixed(6);
      for (let page = 1; page <= Math.ceil((size * 2) / 50); page++) {
        const r = await this.popularityPage({ min, max, page });
        rows.push(...r);
        if (r.length < 50) break;
      }
      if (rows.length >= size) break;
      delta *= 2;
    }
    const uniq = [...new Map(rows.map((r) => [r.id, r])).values()];
    uniq.sort((a, b) => Math.abs(a.popularity - artist.popularity) - Math.abs(b.popularity - artist.popularity));
    const band = uniq.filter((r) => r.id !== artist.id).slice(0, size - 1);
    band.push({ id: artist.id, name: artist.name, popularity: artist.popularity, wikidata: artist.wikidata || null });
    return band;
  }

  async demographics(ids) {
    const body = await this.http.get('/v2/insights', { 'filter.type': 'urn:demographics', 'signal.interests.entities': ids.join(',') });
    const out = new Map();
    for (const d of body?.results?.demographics || []) if (d?.query?.age) out.set(d.entity_id, d.query);
    return out;
  }

  // Weekly trending series. Not used for the quiet check (see src/quiet.js); kept for scripts/check-trending.js.
  async trending(id, start, end) {
    const body = await this.http.get('/v2/trending', {
      'filter.type': ARTIST, 'signal.interests.entities': id, 'filter.start_date': start, 'filter.end_date': end, take: 50,
    });
    return body?.results?.trending || [];
  }
}
