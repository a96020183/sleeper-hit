// HTTP plumbing for Qloo: private on-disk cache, throttle, bounded retry, quota guard, call log.
// The API key travels only in the X-Api-Key header. It is never part of a cache key, a log line,
// an error message, or anything sent to the browser.
// Cache and log live under .private/ (git-ignored): Qloo's developer guide allows private
// server-side caching but forbids storing response data in a public repository.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class QlooError extends Error {
  constructor(message, status = 0, code = 'QLOO_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function cacheKey(pathname, params) {
  const items = Object.keys(params).sort().map((k) => [k, String(params[k])]);
  return crypto.createHash('sha256').update(JSON.stringify([pathname, items])).digest('hex');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class QlooHttp {
  constructor({ base, key, cacheDir, reqPerSec = 4, monthlyFloor = 500, fetchImpl = fetch, label = 'live' }) {
    this.base = base;
    this.#key = key;
    this.cacheDir = cacheDir;
    this.minGapMs = Math.ceil(1000 / Math.max(1, reqPerSec));
    this.monthlyFloor = monthlyFloor;
    this.fetchImpl = fetchImpl;
    this.label = label;
    this.lastCall = 0;
    this.queue = Promise.resolve();
    this.monthRemaining = null;
    this.stats = { live: 0, cached: 0, errors: 0 };
  }

  #key;

  log(entry) {
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      fs.appendFileSync(path.join(this.cacheDir, '..', 'calllog.jsonl'), JSON.stringify({ ts: new Date().toISOString(), source: this.label, ...entry }) + '\n');
    } catch { /* logging must never break a request */ }
  }

  readCache(k) {
    const f = path.join(this.cacheDir, `${k}.json`);
    if (!fs.existsSync(f)) return null;
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
  }

  writeCache(k, value) {
    fs.mkdirSync(this.cacheDir, { recursive: true });
    const f = path.join(this.cacheDir, `${k}.json`);
    fs.writeFileSync(f + '.tmp', JSON.stringify(value));
    fs.renameSync(f + '.tmp', f);
  }

  // Serialised so the throttle holds across concurrent callers.
  get(pathname, params, { useCache = true } = {}) {
    const run = () => this.#get(pathname, params, useCache);
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async #get(pathname, params, useCache) {
    const k = cacheKey(pathname, params);
    const shortParams = summarize(params);
    if (useCache) {
      const hit = this.readCache(k);
      if (hit) {
        this.stats.cached++;
        return hit.body;
      }
    }
    if (this.monthRemaining !== null && this.monthRemaining < this.monthlyFloor) {
      throw new QlooError(`Monthly Qloo quota left (${this.monthRemaining}) is below the floor (${this.monthlyFloor}). Live calls paused; cached data still works.`, 0, 'QUOTA_FLOOR');
    }
    const url = new URL(this.base + pathname);
    for (const [kk, v] of Object.entries(params)) url.searchParams.set(kk, String(v));
    for (let attempt = 0; ; attempt++) {
      const wait = this.lastCall + this.minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastCall = Date.now();
      const t0 = Date.now();
      let res;
      try {
        res = await this.fetchImpl(url, { headers: { 'X-Api-Key': this.#key, Accept: 'application/json' } });
      } catch (e) {
        this.stats.errors++;
        this.log({ path: pathname, params: shortParams, status: null, error: 'network' });
        throw new QlooError(`Qloo network error on ${pathname}`, 0, 'NETWORK');
      }
      const rem = res.headers.get('x-month-ratelimit-remaining');
      if (rem !== null && !Number.isNaN(Number(rem))) this.monthRemaining = Number(rem);
      if (res.status === 429 && attempt < 3) {
        const reset = Number(res.headers.get('x-second-ratelimit-reset')) || 1;
        this.log({ path: pathname, params: shortParams, status: 429, retry: attempt + 1 });
        await sleep(Math.min(5000, reset * 1000 + 250 * (attempt + 1)));
        continue;
      }
      let body;
      try { body = await res.json(); } catch { body = {}; }
      this.log({ path: pathname, params: shortParams, status: res.status, ms: Date.now() - t0, monthRemaining: this.monthRemaining });
      if (res.status >= 400) {
        this.stats.errors++;
        const msg = (body && (body.message || body.error || body.reason)) || '';
        throw new QlooError(`Qloo ${pathname} returned HTTP ${res.status} ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`.trim(), res.status, `HTTP_${res.status}`);
      }
      this.stats.live++;
      if (useCache) this.writeCache(k, { path: pathname, params, fetchedAt: new Date().toISOString(), body });
      return body;
    }
  }
}

function summarize(params) {
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    const s = String(v);
    out[k] = s.includes(',') && s.length > 80 ? `${s.split(',').length} ids` : s;
  }
  return out;
}
