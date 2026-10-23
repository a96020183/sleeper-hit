// Wikipedia page views: the public "is this artist quiet now?" signal.
// Sources (official, free, no key):
//   Wikimedia Pageviews API  https://wikimedia.org/api/rest_v1/metrics/pageviews/  (English Wikipedia,
//                            all access, agent=user so known bots and automated traffic are excluded)
//   Wikidata API             https://www.wikidata.org/w/api.php  (Wikidata id -> English Wikipedia title)
// Wikimedia asks API clients to send a descriptive User-Agent. Responses are cached under .private/.
// Measured 2026-10-23: without contact details in the User-Agent the page-view API allows about 10
// requests a minute, so live calls are spaced 6 seconds apart. Set WIKIMEDIA_CONTACT to identify yourself.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const UA = `SleeperHit/0.1 (Qloo hackathon prototype${process.env.WIKIMEDIA_CONTACT ? `; ${process.env.WIKIMEDIA_CONTACT}` : ''})`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Wiki {
  constructor({ fetchImpl = fetch, cacheDir = path.join(config.privateDir, 'cache', 'wikimedia'), reqPerSec = 1 / 6, offline = false } = {}) {
    this.fetchImpl = fetchImpl;
    this.cacheDir = cacheDir;
    this.minGapMs = Math.ceil(1000 / reqPerSec);
    this.lastCall = 0;
    this.queue = Promise.resolve();
    this.offline = offline;
    this.stats = { live: 0, cached: 0 };
  }

  get(url) {
    const run = () => this.#get(url);
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async #get(url) {
    const f = path.join(this.cacheDir, crypto.createHash('sha256').update(url).digest('hex') + '.json');
    if (fs.existsSync(f)) { this.stats.cached++; return JSON.parse(fs.readFileSync(f, 'utf8')).body; }
    if (this.offline) throw new Error('Wikipedia data not cached and offline mode is on.');
    let res;
    for (let attempt = 0; ; attempt++) {
      const wait = this.lastCall + this.minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastCall = Date.now();
      res = await this.fetchImpl(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA, Accept: 'application/json' } });
      this.stats.live++;
      if (res.status !== 429 || attempt >= 4) break;
      const after = Number(res.headers?.get?.('retry-after')) || 2 * (attempt + 1);
      await sleep(Math.min(30, after) * 1000);
    }
    if (res.status === 404) return null; // no such page, or no views recorded
    if (res.status >= 400) throw new Error(`Wikimedia HTTP ${res.status}`);
    const body = await res.json();
    fs.mkdirSync(this.cacheDir, { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ url, fetchedAt: new Date().toISOString(), body }));
    return body;
  }

  // Wikidata ids (Q123) -> English Wikipedia titles. Ids without an English article are left out.
  async titlesFor(qids) {
    const out = new Map();
    const ids = [...new Set(qids.filter(Boolean).map((q) => q.toUpperCase()))];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const body = await this.get(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${chunk.join('|')}&props=sitelinks&sitefilter=enwiki&format=json`);
      for (const [id, e] of Object.entries(body?.entities || {})) {
        const t = e?.sitelinks?.enwiki?.title;
        if (t) out.set(id, t);
      }
    }
    return out;
  }

  // Monthly views for one English Wikipedia article: [{ month: 'YYYY-MM', views }], oldest first.
  async monthly(title, fromMonth, toMonth) {
    const t = encodeURIComponent(title.replace(/ /g, '_'));
    const body = await this.get(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/user/${t}/monthly/${fromMonth.replace('-', '')}0100/${toMonth.replace('-', '')}0100`);
    return (body?.items || []).map((it) => ({ month: `${it.timestamp.slice(0, 4)}-${it.timestamp.slice(4, 6)}`, views: it.views }));
  }
}

// 'YYYY-MM' arithmetic.
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Wikidata id from a Qloo entity (search returns an object, insights an array). Server-side only.
export function wikidataOf(entity) {
  const w = entity?.properties?.external?.wikidata || entity?.external?.wikidata;
  const id = Array.isArray(w) ? w[0]?.id : w?.id;
  return id ? String(id).toUpperCase() : null;
}
