// Artist strip on Today: /api/artists/summary. Offline (mock Qloo, mock Wikimedia, mock MusicBrainz).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { QlooClient } from '../src/qloo/client.js';
import { decideArtist } from '../src/pipeline.js';
import { ScoreCache, summaryPayload, artistStatus, parseViewerContext, SKIP_LABELS } from '../src/summary.js';
import { decide } from '../src/agent.js';
import { ARTISTS } from '../src/data/artists.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = '2026-10-24';
const UUID = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i;
const KEYS = Object.keys(ARTISTS);

const client = new QlooClient({ mode: 'mock', cacheRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'summary-')) });
const cache = new ScoreCache(client);
const noViewer = parseViewerContext('');

function leaks(json) {
  assert.ok(!UUID.test(json), 'no entity ids');
  assert.ok(!/"(affinity|popularity|pct|blend|affinityRank|popularityRank|topPct)"\s*:/.test(json), 'no raw or derived Qloo values');
  assert.ok(!/urn:|signalId|entity_id|wikidata/.test(json), 'no urns, tags or ids');
}

test('cold: every artist is pending at once, nothing waits on Qloo, and runs are queued in the background', async () => {
  const before = client.http.stats.live;
  const t0 = Date.now();
  const out = summaryPayload(cache, TODAY, noViewer);
  assert.ok(Date.now() - t0 < 50, 'returns without waiting');
  assert.equal(client.http.stats.live, before, 'no Qloo call made by the summary itself');
  assert.equal(out.pending, true);
  assert.deepEqual(out.artists.map((a) => a.key), KEYS);
  for (const a of out.artists) { assert.equal(a.status, 'pending'); assert.equal(a.letters, null); }
  leaks(JSON.stringify(out));
  summaryPayload(cache, TODAY, noViewer); // a second poll does not queue the runs again
  await cache.queue;
  for (const k of KEYS) assert.ok(cache.peek(k, TODAY), `${k} scored in the background`);
});

test('warm: statuses match Today exactly, with zero new Qloo calls and nothing Qloo-specific in the response', async () => {
  await cache.queue;
  const before = client.http.stats.live;
  const out = summaryPayload(cache, TODAY, noViewer);
  assert.equal(client.http.stats.live - before, 0, 'zero new Qloo calls');
  assert.equal(out.pending, false);
  leaks(JSON.stringify(out));
  for (const a of out.artists) {
    const today = decideArtist(await cache.get(a.key, TODAY), { overrides: new Set(), manual: null });
    const letters = today.doors.filter((d) => d.action === 'letter').length;
    assert.equal(a.letters, letters, `${a.key}: letters as on Today`);
    if (letters) assert.deepEqual([a.status, a.label], ['ready', `Letters ready ${letters}`]);
    else if (today.quiet.quiet === false) assert.deepEqual([a.status, a.label], ['not-quiet', 'Not quiet']);
    else if (today.doors.every((d) => d.clearance.category === 'unconfirmed')) assert.deepEqual([a.status, a.label], ['clearance', 'Clearance unconfirmed']);
    else assert.ok(a.label.length > 0 && a.label.length <= 24, `${a.key}: short label`);
  }
  assert.equal(client.http.stats.live - before, 0);
});

test('the viewer’s own share and "knock anyway" change the strip the same way they change Today', async () => {
  await cache.queue;
  const target = KEYS.find((k) => { const st = decideArtist(cache.peek(k, TODAY)); return st.doors.every((d) => d.clearance.category === 'unconfirmed'); });
  if (target) {
    const ctx = parseViewerContext(JSON.stringify({ [target]: { pub: 100, mas: 100 } }));
    const a = summaryPayload(cache, TODAY, ctx).artists.find((x) => x.key === target);
    const today = decideArtist(cache.peek(target, TODAY), { manual: { publishingPct: 100, masterPct: 100 } });
    assert.equal(a.letters, today.doors.filter((d) => d.action === 'letter').length, `${target}: own share`);
    assert.notEqual(a.status, 'clearance');
  }
  const blocked = KEYS.find((k) => cache.peek(k, TODAY).quiet?.quiet === false);
  assert.ok(blocked, 'some demo artist is not quiet in the mock');
  const door = cache.peek(blocked, TODAY).doors[0].id;
  const ctx = parseViewerContext(JSON.stringify({ [blocked]: { overrides: [door] } }));
  const a = summaryPayload(cache, TODAY, ctx).artists.find((x) => x.key === blocked);
  assert.deepEqual([a.status, a.letters], ['ready', 1], 'knock anyway counts as a letter, as on Today');
  assert.deepEqual(parseViewerContext('{not json')['the-clash'], { overrides: new Set(), manual: null }, 'bad context is ignored');
});

test('labels: every skip kind the agent can give has a short label', () => {
  const base = { clearance: { category: 'one-stop', reason: '' }, timing: { bucket: 'in-window', dateStatus: 'announced' }, pct: 95, blend: { affinityRank: 1, of: 100 }, window: { earlier: { label: 'X' } } };
  const kinds = [
    decide([{ ...base, id: 'a' }], { block: 'not quiet' })[0].skip,
    decide([{ ...base, id: 'a', clearance: { category: 'unconfirmed', reason: 'r' } }])[0].skip,
    decide([{ ...base, id: 'a', timing: { bucket: 'too-late', reason: 'too late' } }])[0].skip,
    decide([{ ...base, id: 'a', pct: null }])[0].skip,
    decide([{ ...base, id: 'a', pct: 50 }])[0].skip,
    decide([{ ...base, id: 'a', blend: { affinityRank: 90, of: 100 } }])[0].skip,
    decide([1, 2, 3, 4].map((i) => ({ ...base, id: 'd' + i })))[3].skip,
  ];
  assert.deepEqual(kinds, ['not-quiet', 'clearance', 'timing', 'no-data', 'low-score', 'weak-audience', 'cap']);
  for (const k of kinds) assert.ok(SKIP_LABELS[k] && SKIP_LABELS[k].length <= 24, k);
  const state = { quiet: { quiet: true }, doors: decide([{ ...base, id: 'a', pct: 50 }]) };
  assert.deepEqual(artistStatus(state), { status: 'low-score', letters: 0, label: 'Score too low' });
});

test('front end: no #artist select left, and every element app.js looks up by id exists', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.ok(!/<select[^>]*id="artist"/.test(html), 'header select removed');
  assert.ok(!/\$\('#artist'\)/.test(js), 'no lookup of #artist');
  assert.ok(html.includes('id="artist-strip"') && html.includes('id="today-body"'));
  const ids = new Set([...html.matchAll(/id="([\w-]+)"/g), ...js.matchAll(/id="([\w-]+)/g)].map((m) => m[1]));
  for (const [, id] of js.matchAll(/\$\('#([\w-]+)/g)) assert.ok(ids.has(id), `#${id} exists in index.html or an app.js template`);
});

test('server: /api/artists/summary answers at once, fills in, and leaks nothing', { timeout: 180000 }, async () => {
  const port = 39000 + Math.floor(Math.random() * 900);
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, QLOO_MODE: 'mock', OPENAI_API_KEY: '', PORT: String(port), SLEEPERHIT_TODAY: TODAY }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('server did not start')), 30000);
      child.stdout.on('data', (b) => { if (String(b).includes('Sleeper Hit on')) { clearTimeout(t); resolve(); } });
      child.on('exit', (c) => reject(new Error('server exited ' + c)));
    });
    const base = `http://localhost:${port}/api/artists/summary`;
    const t0 = Date.now();
    const first = await fetch(base);
    assert.equal(first.status, 200);
    assert.ok(Date.now() - t0 < 5000, 'does not wait for scoring');
    leaks(await first.text());
    let body;
    for (let i = 0; i < 120; i++) {
      body = await (await fetch(base + '?ctx=' + encodeURIComponent('{"the-clash":{"pub":100,"mas":0}}'))).json();
      if (!body.pending) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert.equal(body.pending, false, 'all artists scored in the background');
    assert.equal(body.today, TODAY);
    for (const a of body.artists) assert.ok(typeof a.label === 'string' && a.label && Number.isInteger(a.letters), a.key);
    leaks(JSON.stringify(body));
  } finally {
    child.kill();
  }
});
