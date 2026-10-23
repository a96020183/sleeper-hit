// Sleeper Hit server: a small Node HTTP server (no dependencies) that runs the agent and serves the UI.
// Qloo and OpenAI are called only from here; keys never reach the browser.
//
// Built for hosts with a temporary disk that sleep when idle (e.g. Render free):
// - The server keeps no user data. The outbox, "knock anyway" choices and the viewer's own rights
//   share live in the viewer's browser and are sent with each request.
// - The Qloo cache in .private/ is only a speed-up. If it is gone after a restart, the first request
//   re-scores with Qloo (about 20 calls, throttled) and fills it again.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config, todayISO, ROOT } from './src/config.js';
import { QlooClient } from './src/qloo/client.js';
import { ARTISTS, DEFAULT_ARTIST } from './src/data/artists.js';
import { WINDOWS, JUDGING } from './src/data/windows.js';
import { scoreArtist, decideArtist } from './src/pipeline.js';
import { draftLetter, letterFacts, OVERLAP_STRONG } from './src/letter.js';
import { evaluateTiming, TRAILER_LEAD_DAYS, MIN_DAYS, MAX_DAYS } from './src/timing.js';
import { DAILY_CAP, MIN_PERCENTILE } from './src/agent.js';
import { QUIET_RULE } from './src/quiet.js';
import { TOP_K } from './src/evaluate.js';

const client = new QlooClient();
const scores = new Map(); // `${artist}|${date}` -> Promise<scored>
const drafts = new Map(); // draft cache

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
  for (const d of state.doors.filter((x) => x.action === 'letter')) letters[d.id] = await draftFor(state, d, null);
  return {
    mode: { qloo: client.label, letters: config.openaiKey ? 'OpenAI' : 'Template' },
    artists: Object.values(ARTISTS).map((a) => ({ key: a.key, name: a.name })),
    defaultArtist: DEFAULT_ARTIST,
    state,
    letters,
    cap: DAILY_CAP,
  };
}

// Public, aggregate-only files committed under seal/ (no Qloo response values or ids).
function sealFile(name) {
  const f = path.join(ROOT, 'seal', name);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

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
      trailerLead: TRAILER_LEAD_DAYS, minDays: MIN_DAYS, maxDays: MAX_DAYS, dailyCap: DAILY_CAP,
      minPercentile: MIN_PERCENTILE, quiet: QUIET_RULE, overlapStrong: OVERLAP_STRONG, topK: TOP_K,
    },
    seal: sealFile('hashes.json'),
    results: sealFile('results.json'),
    premise: sealFile('premise.json'),
    backtest: sealFile('backtest-v2.json'),
    backtestMethod: method ? { commit: '034f21e', knownBiases: method.knownBiases || [] } : null,
    siblingCheck: sealFile('sibling-check.json'),
    trending: sealFile('trending-check.json'),
    quietCheck: sealFile('quiet-check.json'),
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
    if (url.pathname === '/api/draft' && req.method === 'POST') {
      const b = await readJSON(req);
      const state = await decided(artistParam(b.artist), viewerOptions(b));
      const door = state.doors.find((d) => d.id === b.doorId);
      if (!door) return send(res, 404, { error: 'Unknown door.' });
      if (door.clearance.category === 'unconfirmed') return send(res, 409, { error: 'Clearance is unconfirmed. Confirm who controls the song and recording first.' });
      return send(res, 200, await draftFor(state, door, b.song || null));
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
