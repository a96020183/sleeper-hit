// The artist strip on Today: one status per demo artist, from the same scoring and decision code
// as Today (scoreArtist + decideArtist). It never calls Qloo itself. It reads the per-artist runs
// the server already holds; an artist not scored yet comes back "pending" and is queued, one at a
// time, for the same run Today would make when that artist is opened.
// The response holds names, counts and short labels only: no entity ids, no raw affinity or
// popularity values, no tags.
import { scoreArtist, decideArtist } from './pipeline.js';
import { ARTISTS } from './data/artists.js';

const RETRY_AFTER_ERROR_MS = 2 * 60 * 1000;

// Per-artist, per-day runs. Today, Roster, the draft endpoint and the strip all share it.
export class ScoreCache {
  constructor(client, score = scoreArtist) {
    this.client = client;
    this.score = score;
    this.runs = new Map(); // `${key}|${date}` -> Promise<scored>
    this.done = new Map(); // `${key}|${date}` -> scored (settled runs only)
    this.failed = new Map(); // `${key}|${date}` -> time of the last failure
    this.queue = Promise.resolve();
  }

  get(key, date) {
    const k = `${key}|${date}`;
    if (!this.runs.get(k)) { // absent, or only reserved by schedule()
      const p = this.score(this.client, key, date);
      this.runs.set(k, p);
      p.then((v) => { this.done.set(k, v); this.failed.delete(k); }, () => { this.runs.delete(k); this.failed.set(k, Date.now()); });
    }
    return this.runs.get(k);
  }

  peek(key, date) { return this.done.get(`${key}|${date}`); }

  // Queue a run in the background, one artist after another, unless one is running or failed just now.
  schedule(key, date) {
    const k = `${key}|${date}`;
    if (this.runs.has(k)) return;
    const failedAt = this.failed.get(k);
    if (failedAt && Date.now() - failedAt < RETRY_AFTER_ERROR_MS) return;
    this.failed.delete(k);
    this.runs.set(k, null); // reserved, so a second poll does not queue it again
    this.queue = this.queue.then(() => this.get(key, date).catch(() => {}));
  }

  hasFailed(key, date) { return this.failed.has(`${key}|${date}`); }
}

// Short labels for the strip, in the words Today uses.
export const SKIP_LABELS = {
  'not-quiet': 'Not quiet',
  clearance: 'Clearance unconfirmed',
  timing: 'Out of window',
  'no-data': 'Too little data',
  'low-score': 'Score too low',
  'weak-audience': 'Audience rank too low',
  cap: 'Daily cap reached',
};

// One artist's status from a decided state (the object decideArtist returns).
export function artistStatus(state) {
  const letters = state.doors.filter((d) => d.action === 'letter').length;
  if (letters) return { status: 'ready', letters, label: `Letters ready ${letters}` };
  if (state.quiet?.quiet === false) return { status: 'not-quiet', letters: 0, label: SKIP_LABELS['not-quiet'] };
  if (state.doors.length && state.doors.every((d) => d.clearance.category === 'unconfirmed')) return { status: 'clearance', letters: 0, label: SKIP_LABELS.clearance };
  // Otherwise the reason on the door Today ranks first, i.e. the one closest to a letter.
  const first = [...state.doors].sort((a, b) => a.order - b.order)[0];
  const kind = first?.skip && SKIP_LABELS[first.skip] ? first.skip : 'no-letter';
  return { status: kind, letters: 0, label: SKIP_LABELS[kind] || 'No letter today' };
}

// Viewer context per artist, as the browser sends it: { [key]: { overrides: [doorId], pub, mas } }.
export function parseViewerContext(raw) {
  let obj = {};
  try { obj = raw ? JSON.parse(raw) : {}; } catch { obj = {}; }
  const out = {};
  for (const key of Object.keys(ARTISTS)) {
    const c = obj && typeof obj === 'object' ? obj[key] : null;
    const overrides = new Set(Array.isArray(c?.overrides) ? c.overrides.map(String).slice(0, 20) : []);
    const has = (v) => v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v));
    const manual = c && has(c.pub) && has(c.mas) ? { publishingPct: Number(c.pub), masterPct: Number(c.mas) } : null;
    out[key] = { overrides, manual };
  }
  return out;
}

// The strip payload. Never awaits a Qloo run: settled artists get a status, the rest "pending".
export function summaryPayload(cache, date, context = {}) {
  const artists = Object.values(ARTISTS).map((a) => {
    const scored = cache.peek(a.key, date);
    if (!scored) {
      if (cache.hasFailed(a.key, date)) {
        cache.schedule(a.key, date); // retried after a pause
        return { key: a.key, name: a.name, status: 'unavailable', letters: null, label: 'Retrying soon' };
      }
      cache.schedule(a.key, date);
      return { key: a.key, name: a.name, status: 'pending', letters: null, label: 'Scoring…' };
    }
    const opts = context[a.key] || { overrides: new Set(), manual: null };
    return { key: a.key, name: a.name, ...artistStatus(decideArtist(scored, opts)) };
  });
  return { today: date, pending: artists.some((a) => a.status === 'pending' || a.status === 'unavailable'), artists };
}
