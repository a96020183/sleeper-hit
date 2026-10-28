// Works: a viewer's own catalogue, scored with exactly the same rules as Today.
// The browser keeps the catalogue (localStorage) and sends only artist names, plus the viewer's own
// share and an optional song per artist. The server keeps nothing and answers with ranks,
// percentiles, categories and reasons: no Qloo entity ids, no raw affinity or popularity values.
//
// Same score as Today (and as the backtest): scoreRecord + decideArtist from src/pipeline.js, i.e. the
// affinity + popularity rank blend over the pool, the top-20% knock bar, the quiet rule (Wikipedia
// page views plus no studio album in 5 years), clearance categories and timing. One difference, to
// keep Qloo calls down: Works skips the age-and-gender request, which Today uses only to break exact ties.
//
// Qloo cost: an artist in the cached 3,000-artist pool needs no new Qloo call. An artist outside it
// needs one /search plus one scoring request per open window (6 today), capped per day.
import { scoreRecord, decideArtist, sharedPool, normName } from './pipeline.js';
import { compareDoors, DAILY_CAP } from './agent.js';
import { WINDOWS } from './data/windows.js';
import { ARTIST } from './qloo/client.js';
import { letterFacts, templateLetter, draftLetter } from './letter.js';
import { ARTISTS } from './data/artists.js';

export const WORKS_MAX_ARTISTS = 10; // per scan
export const WORKS_LIMITS = {
  perIpPerDay: Number(process.env.WORKS_IP_DAILY) || 30, // artist analyses per IP per day
  sitePerDay: Number(process.env.WORKS_SITE_DAILY) || 300, // artist analyses per day, whole site
  qlooPerDay: Number(process.env.WORKS_QLOO_DAILY) || 120, // new live Qloo calls per day for artists outside the pool
};
export const OPENAI_LETTERS_PER_SCAN = 3; // the top picks get an OpenAI draft; the rest use the template
const NEW_ARTIST_CALLS = 1 + WINDOWS.filter((w) => w.card).length;

// Daily counters, kept in memory (a restart resets them; that only makes the limit looser once).
export class DailyLimiter {
  constructor(limits = WORKS_LIMITS, now = () => new Date()) {
    this.limits = limits;
    this.now = now;
    this.day = null;
    this.reset();
  }
  reset() { this.byIp = new Map(); this.site = 0; this.qloo = 0; }
  roll() {
    const d = this.now().toISOString().slice(0, 10);
    if (d !== this.day) { this.day = d; this.reset(); }
  }
  // Reserve `n` artist analyses for this IP. Returns null when allowed, or an error message.
  take(ip, n) {
    this.roll();
    const used = this.byIp.get(ip) || 0;
    if (used + n > this.limits.perIpPerDay) {
      const left = Math.max(0, this.limits.perIpPerDay - used);
      return `Daily limit reached: ${this.limits.perIpPerDay} artist analyses per visitor per day (${left} left today). Try again tomorrow, or scan fewer artists.`;
    }
    if (this.site + n > this.limits.sitePerDay) return `The demo has reached its daily limit of ${this.limits.sitePerDay} artist analyses for everyone. Try again tomorrow.`;
    this.byIp.set(ip, used + n);
    this.site += n;
    return null;
  }
  qlooLeft() { this.roll(); return Math.max(0, this.limits.qlooPerDay - this.qloo); }
  spendQloo(n) { this.roll(); this.qloo += n; }
  left(ip) {
    this.roll();
    return { visitor: Math.max(0, this.limits.perIpPerDay - (this.byIp.get(ip) || 0)), site: Math.max(0, this.limits.sitePerDay - this.site) };
  }
}

// Validate the request body: [{ name, pub?, mas?, song? }], 1 to 10 distinct names.
export function parseWorksRequest(body) {
  const list = Array.isArray(body?.artists) ? body.artists : null;
  if (!list || !list.length) return { error: 'Send a list of artist names.' };
  const seen = new Set();
  const out = [];
  for (const a of list) {
    const name = String((typeof a === 'string' ? a : a?.name) || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!name || seen.has(normName(name))) continue;
    seen.add(normName(name));
    const pct = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Math.max(0, Math.min(100, Number(v))));
    const pub = pct(a?.pub), mas = pct(a?.mas);
    out.push({ name, pub: pub !== null && mas !== null ? pub : null, mas: pub !== null && mas !== null ? mas : null, song: String(a?.song || '').trim().slice(0, 120) || null });
  }
  if (!out.length) return { error: 'Send a list of artist names.' };
  if (out.length > WORKS_MAX_ARTISTS) return { error: `Up to ${WORKS_MAX_ARTISTS} artists per scan. You sent ${out.length}.` };
  return { artists: out };
}

// A demo artist keeps its English Wikipedia title, so its quiet check reads the same page as on Today.
const DEMO_BY_NAME = new Map(Object.values(ARTISTS).map((x) => [normName(x.name), x]));
const recordFor = (a, qlooName) => ({
  key: 'works:' + normName(a.name),
  name: qlooName || a.name,
  wikipedia: DEMO_BY_NAME.get(normName(qlooName || a.name))?.wikipedia,
  songs: a.song ? [a.song] : [],
  clearanceNote: a.pub !== null ? 'Your own share, entered in Works.' : '',
  sources: [],
  clearance: { publishing: { controllers: [] }, master: { controllers: [] }, manual: null },
  royaltyStatements: null,
});

// Public summary of one decided artist: what the Works card and the ranked list show.
function publicDoor(d) {
  return {
    id: d.id, title: d.window.title + (d.window.season ? ` ${d.window.season}` : ''), kind: d.window.kind, earlier: d.window.earlier.label,
    use: d.timing.use || '', event: d.timing.event, date: d.timing.date, dateStatus: d.timing.dateStatus, bucket: d.timing.bucket,
    topPct: d.topPct, rank: d.blend?.rank ?? null, affinityRank: d.blend?.affinityRank ?? null, popularityRank: d.blend?.popularityRank ?? null, of: d.blend?.of ?? null,
    audienceTop: d.audienceTop || [], action: d.action, reason: d.reason || '', overridden: !!d.overridden,
  };
}

// Why an artist gets no letter today, in one line.
export function headlineReason(state) {
  if (state.quiet?.quiet === false) return 'Not quiet right now, so no letters.';
  if (state.quiet?.quiet !== true) return 'Quiet check could not be completed, so no letters.';
  const scored = state.doors.filter((d) => d.topPct);
  if (!scored.length) return 'Qloo has too little data to rank this artist for any open window.';
  const best = Math.min(...scored.map((d) => d.topPct));
  if (best > 20) return `No open window ranks them inside the top 20% (best: top ${best}%).`;
  if (state.doors.every((d) => d.clearance.category === 'unconfirmed')) return 'Clearance unconfirmed: add your share of the song and recording to get letters.';
  const firstSkip = state.doors.find((d) => d.action === 'skip' && d.topPct && d.topPct <= 20);
  return firstSkip ? firstSkip.reason : 'No window passes every rule today.';
}

export function summarize(state) {
  const doors = state.doors.map(publicDoor);
  const ranked = doors.filter((d) => d.topPct).sort((a, b) => a.topPct - b.topPct);
  const letters = state.doors.filter((d) => d.action === 'letter');
  return {
    quiet: state.quiet,
    clearance: { category: state.doors[0]?.clearance.category || 'unconfirmed', label: state.doors[0]?.clearance.label || 'Unconfirmed', reason: state.doors[0]?.clearance.reason || '', manual: !!state.doors[0]?.clearance.manual },
    best: ranked[0] || null,
    letters: letters.length,
    why: letters.length ? '' : headlineReason(state),
    doors,
  };
}

// Score a viewer's catalogue. `limiter` caps new Qloo calls; `draft` drafts letters (OpenAI or template).
export async function scoreWorks(client, entries, today, { limiter = null, draft = draftLetter } = {}) {
  const pool = await sharedPool(client);
  const byName = new Map();
  for (const a of pool) if (!byName.has(normName(a.name))) byName.set(normName(a.name), a);
  const artists = [];
  const picks = [];
  for (const a of entries) {
    const row = { input: a.name, name: a.name, inPool: false, status: 'scored', song: a.song, share: a.pub !== null ? { pub: a.pub, mas: a.mas } : null };
    try {
      let entity = byName.get(normName(a.name)) || null;
      row.inPool = !!entity;
      if (!entity) {
        if (limiter && limiter.qlooLeft() < NEW_ARTIST_CALLS) {
          artists.push({ ...row, status: 'limit', why: 'Today’s Qloo budget for artists outside our 3,000-artist pool is used up. Artists in the pool still work. Try again tomorrow.' });
          continue;
        }
        const before = client.http.stats.live;
        try {
          entity = await client.resolve({ query: a.name, type: ARTIST });
        } finally {
          limiter?.spendQloo(client.http.stats.live - before);
        }
      }
      const before = client.http.stats.live;
      let scored;
      try {
        scored = await scoreRecord(client, recordFor(a, entity.name), today, { entity, demographics: false });
      } finally {
        limiter?.spendQloo(client.http.stats.live - before);
      }
      const manual = a.pub !== null ? { publishingPct: a.pub, masterPct: a.mas } : null;
      const state = decideArtist(scored, { manual });
      row.name = state.artist.name;
      Object.assign(row, summarize(state));
      for (const d of state.doors.filter((x) => x.action === 'letter')) picks.push({ artist: state.artist.name, song: a.song, door: d, record: scored.record, manualPct: state.artist.manualPct });
    } catch (e) {
      const notFound = e.code === 'NEEDS_INPUT';
      row.status = notFound ? 'not-found' : 'error';
      row.why = notFound ? `Qloo has no artist named exactly “${a.name}”. Check the spelling.` : `Could not score: ${e.message}`;
    }
    artists.push(row);
  }

  // Catalogue-level Today: every letter, ranked by the same rules Today uses to order doors.
  picks.sort((x, y) => compareDoors(x.door, y.door) || x.artist.localeCompare(y.artist));
  const ranked = [];
  for (const [i, p] of picks.entries()) {
    const facts = letterFacts({ artist: { ...p.record, songs: p.song ? [p.song] : [] }, door: p.door, song: p.song, manualPct: p.manualPct });
    const letter = i < OPENAI_LETTERS_PER_SCAN ? await draft(facts) : { text: templateLetter(facts), engine: 'template' };
    ranked.push({
      artist: p.artist, song: p.song || null, recipient: p.door.recipient, ...publicDoor(p.door),
      clearance: { category: p.door.clearance.category, label: p.door.clearance.label },
      letter: { text: letter.text, engine: letter.engine, error: letter.error || null },
    });
  }
  // Order the artist cards: those with letters first (by their best pick), then by best window.
  const order = new Map();
  ranked.forEach((r, i) => { if (!order.has(r.artist)) order.set(r.artist, ranked.length - i); });
  artists.sort((x, y) => (order.get(y.name) || 0) - (order.get(x.name) || 0) || (x.best?.topPct ?? 999) - (y.best?.topPct ?? 999));
  return { today, cap: DAILY_CAP, picks: ranked, artists };
}
