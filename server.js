// Sleeper Hit server: a small Node HTTP server (no dependencies) that runs the agent and serves the UI.
// Qloo and OpenAI are called only from here; keys never reach the browser.
//
// Built for hosts with a temporary disk that sleep when idle (e.g. Render free):
// - The server keeps no user data. The outbox, "knock anyway" choices and the viewer's own rights
//   share live in the viewer's browser and are sent with each request.
// - The Qloo cache in .private/ is only a speed-up. If it is gone after a restart, the first request
//   re-scores the pool with Qloo (about 370 calls, throttled to 4 a second) and fills it again.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config, todayISO, ROOT } from './src/config.js';
import { QlooClient } from './src/qloo/client.js';
import { ARTISTS, DEFAULT_ARTIST } from './src/data/artists.js';
import { WINDOWS, JUDGING } from './src/data/windows.js';
import { scoreArtist, decideArtist, windowRanks, popularityOnly, normName } from './src/pipeline.js';
import { SCAN } from './src/data/sleepers.js';
import { draftLetter, letterFacts, OVERLAP_STRONG } from './src/letter.js';
import { evaluateTiming, TRAILER_LEAD_DAYS, MIN_DAYS, MAX_DAYS, SERIES_LOCK_DAYS } from './src/timing.js';
import { DAILY_CAP, MIN_PERCENTILE, AFFINITY_TOP_SHARE } from './src/agent.js';
import { QUIET_RULE, CATALOGUE_RULE } from './src/quiet.js';
import { TOP_K } from './src/evaluate.js';
import { scoreWorks, parseWorksRequest, DailyLimiter, WORKS_MAX_ARTISTS } from './src/works.js';

const client = new QlooClient();
const scores = new Map(); // `${artist}|${date}` -> Promise<scored>
const drafts = new Map(); // draft cache
const worksLimiter = new DailyLimiter(); // per-visitor and site-wide daily caps for Works scans

// The visitor's address: a CDN-set header if present, else the first X-Forwarded-For entry (hosts like
// Render put the app behind a proxy). A forged header only moves a visitor to another per-visitor
// bucket; the site-wide daily cap still holds.
function clientIp(req) {
  const h = req.headers;
  const ip = h['cf-connecting-ip'] || h['true-client-ip'] || String(h['x-forwarded-for'] || '').split(',')[0];
  return String(ip || req.socket.remoteAddress || 'unknown').trim();
}

function getScore(artistKey, date) {
  const k = `${artistKey}|${date}`;
  if (!scores.has(k)) {
    const p = scoreArtist(client, artistKey, date);
    p.catch(() => scores.delete(k));
    scores.set(k, p);
  }
  return scores.get(k);
}

const artistParam = (k) => (ARTISTS[k] ? k : DEFAULT_ARTIST);

// Viewer context from the query string or a JSON body: overrides=a,b  pub=70  mas=0
function viewerOptions(src) {
  const get = (k) => (typeof src.get === 'function' ? src.get(k) : src[k]);
  const ov = get('overrides');
  const overrides = new Set((Array.isArray(ov) ? ov : String(ov || '').split(',')).filter(Boolean));
  const pub = get('pub'), mas = get('mas');
  const has = (v) => v !== null && v !== undefined && v !== '';
  const manual = has(pub) && has(mas) ? { publishingPct: pub, masterPct: mas } : null;
  return { overrides, manual };
}

async function decided(artistKey, opts) {
  return decideArtist(await getScore(artistKey, todayISO()), opts);
}

async function draftFor(state, door, song) {
  const k = [state.artist.key, state.today, door.id, door.clearance.category, state.artist.manualPct, song || ''].join('|');
  if (!drafts.has(k)) {
    if (drafts.size > 500) drafts.clear();
    const d = await draftLetter(letterFacts({ artist: ARTISTS[state.artist.key], door, song, manualPct: state.artist.manualPct }));
    drafts.set(k, { ...d, song: song || null });
  }
  return drafts.get(k);
}

async function statePayload(artistKey, opts) {
  const state = await decided(artistKey, opts);
  const letters = {};
  for (const d of state.doors.filter((x) => x.action === 'letter')) letters[d.id] = await draftFor(state, d, state.artist.songs[0] || null);
  return {
    mode: { qloo: client.label, letters: config.openaiKey ? 'OpenAI' : 'Template' },
    artists: Object.values(ARTISTS).map((a) => ({ key: a.key, name: a.name })),
    defaultArtist: DEFAULT_ARTIST,
    state,
    letters,
    cap: DAILY_CAP,
  };
}

// Roster view: every open window, with the roster's artists ranked by that window's audience.
// Uses the same per-artist runs as /api/state (cached), so it adds no Qloo calls once those are warm.
async function rosterPayload() {
  const states = [];
  let changed = 0, decisions = 0;
  const changes = [];
  for (const key of Object.keys(ARTISTS)) {
    const scored = await getScore(key, todayISO());
    const st = decideArtist(scored, { overrides: new Set(), manual: null });
    const pop = decideArtist(popularityOnly(scored), { overrides: new Set(), manual: null });
    for (const d of st.doors) {
      const p = pop.doors.find((x) => x.id === d.id);
      decisions++;
      if (p.action !== d.action) { changed++; changes.push(`${st.artist.name} / ${d.window.title}: ${d.action === 'letter' ? 'letter' : 'no letter'} with Qloo, ${p.action === 'letter' ? 'letter' : 'no letter'} on popularity alone`); }
    }
    states.push(st);
  }
  const scanRanks = {};
  for (const d of states[0].doors) {
    try {
      const ranks = await windowRanks(client, d.id);
      const rows = SCAN.artists.map((a) => ({ name: a.name, year: a.lastStudioAlbum?.year || '', r: ranks.get(normName(a.name)) })).filter((x) => x.r);
      const byScore = [...rows].sort((a, b) => a.r.rank - b.r.rank).slice(0, 5).map((x) => ({ name: x.name, year: x.year, topPct: x.r.topPct, affinityRank: x.r.affinityRank }));
      const byPop = [...rows].sort((a, b) => a.r.popularityRank - b.r.popularityRank).slice(0, 5).map((x) => x.name);
      scanRanks[d.id] = { byScore, byPop };
    } catch { /* window not scorable: leave it out */ }
  }
  const windows = states[0].doors.map((d0) => {
    const rows = states.map((st) => {
      const d = st.doors.find((x) => x.id === d0.id);
      return { key: st.artist.key, name: st.artist.name, topPct: d.topPct, quiet: st.quiet.quiet, action: d.action, reason: st.quiet.quiet === false ? 'Not quiet' : (d.reason || '') };
    }).sort((a, b) => (a.topPct ?? 999) - (b.topPct ?? 999));
    return { id: d0.id, title: d0.window.title + (d0.window.season ? ` ${d0.window.season}` : ''), kind: d0.window.kind, earlier: d0.window.earlier.label, use: d0.timing.use || '', timing: { event: d0.timing.event, date: d0.timing.date, dateStatus: d0.timing.dateStatus, bucket: d0.timing.bucket, reason: d0.timing.reason || '' }, rows, scan: scanRanks[d0.id] || null };
  });
  const order = { 'in-window': 0, early: 1, unknown: 2, 'too-late': 3 };
  windows.sort((a, b) => (order[a.timing.bucket] ?? 9) - (order[b.timing.bucket] ?? 9));
  return { mode: { qloo: client.label }, letters: windows.reduce((n, w) => n + w.rows.filter((r) => r.action === 'letter').length, 0), artists: states.length, windows, withoutQloo: { changed, decisions, changes }, scan: { at: SCAN.at, famous: SCAN.famous, quiet: SCAN.quiet } };
}

// Public, aggregate-only files committed under seal/ (no Qloo response values or ids).
function sealFile(name) {
  const f = path.join(ROOT, 'seal', name);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

// The card and seal score changed after the backtest. Said plainly on the Trust tab.
const SCORE_CHANGE = {
  changedOn: '2026-10-23',
  now: 'qlooBlend',
  before: 'qlooExcess',
  text: 'We changed this score after seeing the backtest. Until Oct 23 the card and the seal used excess affinity (the artist’s affinity percentile among artists of similar popularity). It did not clear the registered bar. Of the four Qloo uses registered before the backtest, only the rank blend did, so the card and the seal now use it. Picking the winner after the fact favours it; the sealed forecast, settled after release, is the test it has not seen. The original score stays in the seal and will be reported next to it.',
};

// Where song lists and attention data come from, and how each is used.
const DATA_SOURCES = [
  { name: 'Netflix Tudum', url: 'https://www.netflix.com/tudum', use: 'Song lists for the 6 series in the backtest and for Black Doves season 1 in the seal (12 articles), each read once, 3 seconds apart. netflix.com/robots.txt allows our crawler. Only artist names are kept; some lists are highlights, not every song.' },
  { name: 'MusicBrainz', url: 'https://musicbrainz.org/doc/MusicBrainz_API', use: 'Soundtrack albums for the 20 films and games in the backtest, and the earlier titles’ lists for the seal. Official /ws/2 web service, about 300 targeted lookups, one request every 1.1 seconds with a descriptive User-Agent, as the API documentation asks. Core data is CC0. Albums can differ from what is used on screen.' },
  { name: 'MusicBrainz (catalogue check)', url: 'https://musicbrainz.org/doc/MusicBrainz_API', use: 'Latest studio album for the quiet check: the artist linked to the Wikidata id Qloo carries, then its release groups with primary type Album and no secondary type, leaving out bootleg-only groups. About 830 lookups on Oct 23. Same /ws/2 rules: 1.1 seconds apart, descriptive User-Agent, cached. Entries can be wrong, and one bad entry can drop an artist.' },
  { name: 'Wikimedia Pageviews and Wikidata', url: 'https://wikimedia.org/api/rest_v1/', use: 'Monthly English Wikipedia views for the quiet check (known bots excluded), one request per artist, cached.' },
  { name: 'Not used', url: '', use: 'Tunefind (its robots.txt blocks our crawler) and the iTunes Search API (robots.txt disallows /search).' },
];

// The demo artist is chosen by us, not by the selection rule. Only claims with a public source.
const DEMO_PICK = {
  artist: 'The Clash',
  text: 'The Clash is the default demo because we chose it, not because the rule ranked it first. On Oct 23, npm run find-sleepers (the pool’s 500 most popular, best open door in the top 20%, quiet by page views and catalogue) put it 9th of 55. We picked it because its original recordings have been licensed for the screen, so a pitch letter for them is believable. Some acts ranked above it, such as The Beatles, have licensed their original recordings to TV very rarely, which would make the demo letter less realistic.',
  sources: [
    { claim: 'Stranger Things season 1, episode 2, uses The Clash’s “Should I Stay or Should I Go”.', label: 'Netflix Tudum, every song in Stranger Things', url: 'https://www.netflix.com/tudum/articles/stranger-things-every-song' },
    { claim: 'Mad Men’s use of “Tomorrow Never Knows” (2012) was reported as the first time a Beatles master recording was licensed for a TV show (about $250,000, per the Wall Street Journal).', label: 'The World (PRX), May 2012', url: 'https://theworld.org/stories/2012-05-07/mad-men-spends-big-beatles-song' },
  ],
};

// How much Qloo this build used (our own call log, counts only).
const QLOO_USE = {
  liveCalls: 6369,
  endpoints: ['/search', '/v2/insights', '/v2/trending'],
  insightTypes: ['urn:entity:artist', 'urn:demographics', 'urn:tag'],
  searchTypes: ['urn:entity:artist', 'urn:entity:movie', 'urn:entity:tv_show', 'urn:entity:videogame'],
  rejected: 1,
  coldStart: 370,
};

function trustPayload() {
  const today = todayISO();
  const method = sealFile('backtest-v2-method.json');
  return {
    mode: { qloo: client.label },
    today,
    judging: JUDGING,
    candidates: WINDOWS.map((w) => {
      const timing = evaluateTiming(w, today);
      return {
        id: w.id, title: w.title, season: w.season || '', kind: w.kind, signal: w.earlier.label,
        sealed: !!w.sealed, postHoc: !!w.postHoc, sources: w.sources || [], note: w.note || '', timing,
        inJudging: !timing.date || timing.date.length < 10 ? 'unknown' : timing.date >= JUDGING.start && timing.date <= JUDGING.end ? 'yes' : 'no',
      };
    }),
    pool: { n: config.poolN, bands: config.poolBands, rule: 'The first N artists Qloo returns for popularity 0.9 or higher, most popular first, split into 10 equal popularity bands. Qloo paging skips some very popular artists (Drake, for one), so this is not the complete top N.' },
    rules: {
      trailerLead: TRAILER_LEAD_DAYS, minDays: MIN_DAYS, maxDays: MAX_DAYS, seriesLockDays: SERIES_LOCK_DAYS, dailyCap: DAILY_CAP,
      minPercentile: MIN_PERCENTILE, affinityTopShare: AFFINITY_TOP_SHARE, quiet: QUIET_RULE, catalogue: CATALOGUE_RULE, overlapStrong: OVERLAP_STRONG, topK: TOP_K,
    },
    seal: sealFile('hashes.json'),
    results: sealFile('results.json'),
    premise: sealFile('premise.json'),
    backtest: sealFile('backtest-v2.json'),
    backtestMethod: method ? { commit: '034f21e', knownBiases: method.knownBiases || [] } : null,
    scoreChange: SCORE_CHANGE,
    dataSources: DATA_SOURCES,
    qlooUse: QLOO_USE,
    siblingCheck: sealFile('sibling-check.json'),
    trending: sealFile('trending-check.json'),
    quietCheck: sealFile('quiet-check.json'),
    demoPick: DEMO_PICK,
  };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJSON(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 200000) throw new Error('Body too large'); }
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/healthz') return send(res, 200, { ok: true });
    if (url.pathname === '/api/state' && req.method === 'GET') {
      return send(res, 200, await statePayload(artistParam(url.searchParams.get('artist')), viewerOptions(url.searchParams)));
    }
    if (url.pathname === '/api/trust' && req.method === 'GET') return send(res, 200, trustPayload());
    if (url.pathname === '/api/roster' && req.method === 'GET') return send(res, 200, await rosterPayload());
    if (url.pathname === '/api/draft' && req.method === 'POST') {
      const b = await readJSON(req);
      const state = await decided(artistParam(b.artist), viewerOptions(b));
      const door = state.doors.find((d) => d.id === b.doorId);
      if (!door) return send(res, 404, { error: 'Unknown door.' });
      if (door.clearance.category === 'unconfirmed') return send(res, 409, { error: 'Clearance is unconfirmed. Confirm who controls the song and recording first.' });
      return send(res, 200, await draftFor(state, door, b.song || null));
    }
    if (url.pathname === '/api/works/scan' && req.method === 'POST') {
      const parsed = parseWorksRequest(await readJSON(req));
      if (parsed.error) return send(res, 400, { error: parsed.error });
      const ip = clientIp(req);
      const refused = worksLimiter.take(ip, parsed.artists.length);
      if (refused) return send(res, 429, { error: refused, left: worksLimiter.left(ip) });
      const out = await scoreWorks(client, parsed.artists, todayISO(), { limiter: worksLimiter });
      return send(res, 200, { ...out, scannedAt: new Date().toISOString(), mode: { qloo: client.label, letters: config.openaiKey ? 'OpenAI' : 'Template' }, left: worksLimiter.left(ip), limits: { perScan: WORKS_MAX_ARTISTS, perVisitorPerDay: worksLimiter.limits.perIpPerDay } });
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found.' });

    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(ROOT, 'public', rel));
    if (!file.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
    return send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    console.error(`[${req.method} ${url.pathname}]`, e.message);
    return send(res, 502, { error: e.message || 'Something went wrong.' });
  }
});

server.listen(config.port, () => {
  console.log(`Sleeper Hit on http://localhost:${config.port}  (Qloo: ${client.label}, letters: ${config.openaiKey ? 'OpenAI' : 'template'})`);
  // Warm the default artist so the first visitor after a restart waits less.
  getScore(DEFAULT_ARTIST, todayISO()).then(() => console.log('Warm-up done.')).catch((e) => console.error('Warm-up failed:', e.message));
});

