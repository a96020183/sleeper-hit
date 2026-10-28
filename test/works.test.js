// Works: the viewer's own catalogue, scored with the same rules as Today. Offline (mock Qloo,
// mock Wikimedia, mock MusicBrainz).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { QlooClient } from '../src/qloo/client.js';
import { scoreArtist, decideArtist } from '../src/pipeline.js';
import { scoreWorks, parseWorksRequest, DailyLimiter, WORKS_MAX_ARTISTS } from '../src/works.js';
import { templateLetter } from '../src/letter.js';
import { mailtoFor, parseCatalogue, catalogueText } from '../public/lib.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = '2026-10-24';
const UUID = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i;
const template = async (facts) => ({ text: templateLetter(facts), engine: 'template' });

// One mock client for the whole file: the pool is scored once.
const client = new QlooClient({ mode: 'mock', cacheRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'works-')) });

test('Works scores an artist exactly like Today: same ranks, top %, quiet verdict, clearance and decisions', async () => {
  const manual = { publishingPct: 100, masterPct: 0 };
  let lettersSeen = 0;
  for (const [key, name] of [['the-clash', 'The Clash'], ['the-verve', 'The Verve'], ['air-supply', 'Air Supply'], ['iggy-pop', 'Iggy Pop']]) {
    const today = decideArtist(await scoreArtist(client, key, TODAY), { manual });
    const works = await scoreWorks(client, [{ name, pub: 100, mas: 0, song: null }], TODAY, { draft: template });
    const w = works.artists[0];
    assert.equal(w.status, 'scored', name);
    assert.equal(w.inPool, true, name);
    assert.equal(w.quiet.quiet, today.quiet.quiet, `${name}: quiet verdict`);
    assert.equal(w.clearance.category, today.doors[0].clearance.category, `${name}: clearance`);
    for (const d of today.doors) {
      const x = w.doors.find((y) => y.id === d.id);
      assert.ok(x, `${name}: door ${d.id}`);
      assert.equal(x.topPct, d.topPct, `${name}/${d.id}: top %`);
      assert.equal(x.rank, d.blend?.rank ?? null, `${name}/${d.id}: blended rank`);
      assert.equal(x.affinityRank, d.blend?.affinityRank ?? null, `${name}/${d.id}: affinity rank`);
      assert.equal(x.popularityRank, d.blend?.popularityRank ?? null, `${name}/${d.id}: popularity rank`);
      assert.equal(x.action, d.action, `${name}/${d.id}: decision`);
      assert.equal(x.reason, d.reason, `${name}/${d.id}: reason`);
    }
    const letters = today.doors.filter((d) => d.action === 'letter').map((d) => d.id).sort();
    assert.deepEqual(works.picks.map((p) => p.id).sort(), letters, `${name}: letters`);
    lettersSeen += letters.length;
  }
  assert.ok(lettersSeen > 0, 'the comparison includes doors that get letters');
});

test('Works ranks letters across the catalogue with Today’s door order, and drafts every letter', async () => {
  const out = await scoreWorks(client, [{ name: 'The Clash', pub: 100, mas: 0, song: 'London Calling' }, { name: 'Iggy Pop', pub: 100, mas: 100, song: null }], TODAY, { draft: template });
  for (const p of out.picks) {
    assert.ok(p.letter.text.includes(p.artist));
    assert.ok(!/\d+\.\d{3,}/.test(p.letter.text), 'no raw score in the letter');
  }
  // one-stop (Iggy Pop, 100/100) outranks cover (The Clash, 100/0) when both are in the window
  const cats = out.picks.map((p) => p.clearance.category);
  const order = { 'one-stop': 0, cover: 1, 'needs-consent': 2 };
  for (let i = 1; i < cats.length; i++) {
    if (out.picks[i].bucket === out.picks[i - 1].bucket) assert.ok(order[cats[i - 1]] <= order[cats[i]], 'clearance first, as on Today');
  }
});

test('Works without a share: clearance unconfirmed, no letter, and the card says why', async () => {
  const out = await scoreWorks(client, [{ name: 'The Clash', pub: null, mas: null, song: null }], TODAY, { draft: template });
  assert.equal(out.picks.length, 0);
  assert.equal(out.artists[0].clearance.category, 'unconfirmed');
  assert.ok(out.artists[0].why.length > 10);
});

test('Works response carries no Qloo entity ids, raw affinity or popularity values, or tags', async () => {
  const out = await scoreWorks(client, [{ name: 'The Clash', pub: 100, mas: 0, song: null }, { name: 'Mock Artist 3150', pub: 100, mas: 0, song: null }, { name: 'Nobody Exactly Like This', pub: null, mas: null, song: null }], TODAY, { draft: template });
  const json = JSON.stringify(out);
  assert.ok(!UUID.test(json), 'no entity ids');
  assert.ok(!/"(affinity|popularity)"\s*:/.test(json), 'no raw affinity or popularity fields');
  assert.ok(!/urn:/.test(json), 'no Qloo urns or tags');
  assert.ok(!/signalId|entity_id|wikidata/.test(json));
  assert.equal(out.artists.find((a) => a.input === 'Nobody Exactly Like This').status, 'not-found');
  // Today's payload is held to the same rule.
  assert.ok(!UUID.test(JSON.stringify(decideArtist(await scoreArtist(client, 'the-clash', TODAY)))));
});

test('artists in the cached pool need no new Qloo call; artists outside it are capped per day', async () => {
  await scoreWorks(client, [{ name: 'The Clash', pub: 100, mas: 0, song: null }], TODAY, { draft: template }); // warm
  const before = client.http.stats.live;
  await scoreWorks(client, [{ name: 'Culture Club', pub: 100, mas: 0, song: null }], TODAY, { draft: template });
  assert.equal(client.http.stats.live - before, 0, 'pool artist: zero Qloo calls');

  const lim = new DailyLimiter({ perIpPerDay: 30, sitePerDay: 300, qlooPerDay: 20 });
  const out = await scoreWorks(client, [{ name: 'Mock Artist 3101', pub: 100, mas: 0, song: null }], TODAY, { limiter: lim, draft: template });
  assert.equal(out.artists[0].inPool, false);
  assert.equal(out.artists[0].status, 'scored');
  assert.ok(lim.qloo > 0 && lim.qloo <= 6, `outside the pool: ${lim.qloo} calls`);
  const broke = new DailyLimiter({ perIpPerDay: 30, sitePerDay: 300, qlooPerDay: 3 });
  const refused = await scoreWorks(client, [{ name: 'Mock Artist 3102', pub: 100, mas: 0, song: null }, { name: 'The Clash', pub: 100, mas: 0, song: null }], TODAY, { limiter: broke, draft: template });
  assert.equal(refused.artists.find((a) => a.input === 'Mock Artist 3102').status, 'limit');
  assert.equal(refused.artists.find((a) => a.input === 'The Clash').status, 'scored', 'pool artists still work');
  assert.equal(broke.qloo, 0);
});

test('daily limiter: per visitor, site-wide, and resets the next day', () => {
  let now = new Date('2026-10-28T10:00:00Z');
  const lim = new DailyLimiter({ perIpPerDay: 30, sitePerDay: 45, qlooPerDay: 100 }, () => now);
  assert.equal(lim.take('a', 10), null);
  assert.equal(lim.take('a', 10), null);
  assert.equal(lim.take('a', 10), null);
  assert.match(lim.take('a', 1), /30 artist analyses per visitor per day \(0 left today\)/);
  assert.equal(lim.take('b', 10), null);
  assert.match(lim.take('c', 10), /daily limit of 45/);
  now = new Date('2026-10-29T00:00:01Z');
  assert.equal(lim.take('a', 10), null);
});

test('request rules: 1 to 10 distinct names, shares only as a pair', () => {
  assert.match(parseWorksRequest({ artists: Array.from({ length: 11 }, (_, i) => ({ name: 'A' + i })) }).error, /Up to 10 artists/);
  assert.match(parseWorksRequest({}).error, /list of artist names/);
  const ok = parseWorksRequest({ artists: [{ name: ' The  Clash ' }, { name: 'the clash' }, { name: 'X', pub: 100 }, { name: 'Y', pub: 50, mas: 0, song: 'S' }] });
  assert.equal(ok.artists.length, 3);
  assert.equal(ok.artists[0].name, 'The Clash');
  assert.equal(ok.artists[1].pub, null, 'one share alone is ignored');
  assert.deepEqual(ok.artists[2], { name: 'Y', pub: 50, mas: 0, song: 'S' });
  assert.equal(WORKS_MAX_ARTISTS, 10);
});

test('mailto: subject from the letter, body without the header lines, recipient only if it is an address', () => {
  const letter = 'To: Music supervisor, Grand Theft Auto VI\nSubject: London Calling by The Clash for Grand Theft Auto VI\n\nHi [Name],\n\nI\'d like to put "London Calling" forward & more.\n\nBest,\n[Your name]';
  const m = mailtoFor(letter, 'sync@studio.example');
  assert.ok(m.startsWith('mailto:sync@studio.example?subject='));
  const u = new URL(m);
  assert.equal(u.searchParams.get('subject'), 'London Calling by The Clash for Grand Theft Auto VI');
  const body = decodeURIComponent(m.split('&body=')[1]);
  assert.ok(body.startsWith('Hi [Name],\r\n\r\nI\'d like to put "London Calling" forward & more.'));
  assert.ok(!body.includes('To:') && !body.includes('Subject:'));
  assert.ok(m.includes('%0D%0A'), 'line breaks as CRLF');
  assert.ok(!m.includes(' '), 'fully encoded');
  assert.ok(mailtoFor(letter, '').startsWith('mailto:?subject='), 'empty recipient: the email app asks');
  assert.ok(mailtoFor(letter, 'not an address').startsWith('mailto:?'));
  assert.ok(mailtoFor(letter, 'a@b.c?cc=x@y.z').startsWith('mailto:?'), 'no header injection through the address');
});

test('catalogue text: names with commas, optional shares and song, and back again', () => {
  const list = parseCatalogue('The Clash, 100, 0, London Calling\n\nCrosby, Stills, Nash & Young\nThe Smiths, 50%, 0\n');
  assert.deepEqual(list, [
    { name: 'The Clash', pub: 100, mas: 0, song: 'London Calling' },
    { name: 'Crosby, Stills, Nash & Young', pub: null, mas: null, song: null },
    { name: 'The Smiths', pub: 50, mas: 0, song: null },
  ]);
  assert.deepEqual(parseCatalogue(catalogueText(list)), list);
});

// The HTTP layer: limits, removed endpoints, no wide-open CORS. Starts the real server on the mock.
test('server: /api/works/scan enforces its limits and leaks nothing; old endpoints and open CORS are gone', { timeout: 120000 }, async () => {
  const port = 39000 + Math.floor(Math.random() * 900);
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, QLOO_MODE: 'mock', OPENAI_API_KEY: '', PORT: String(port), SLEEPERHIT_TODAY: TODAY, WORKS_IP_DAILY: '3', WORKS_SITE_DAILY: '100' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('server did not start')), 30000);
      child.stdout.on('data', (b) => { if (String(b).includes('Sleeper Hit on')) { clearTimeout(t); resolve(); } });
      child.on('exit', (c) => reject(new Error('server exited ' + c)));
    });
    const base = `http://localhost:${port}`;
    const post = (body) => fetch(base + '/api/works/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const tooMany = await post({ artists: Array.from({ length: 11 }, (_, i) => ({ name: 'A' + i })) });
    assert.equal(tooMany.status, 400);
    assert.match((await tooMany.json()).error, /Up to 10/);
    const ok = await post({ artists: [{ name: 'The Clash', pub: 100, mas: 0 }, { name: 'Air Supply' }] });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('access-control-allow-origin'), null, 'no wide-open CORS');
    const text = await ok.text();
    assert.ok(!UUID.test(text), 'no entity ids over the wire');
    const body = JSON.parse(text);
    assert.equal(body.left.visitor, 1);
    const over = await post({ artists: [{ name: 'The Clash' }, { name: 'Iggy Pop' }] });
    assert.equal(over.status, 429);
    assert.match((await over.json()).error, /3 artist analyses per visitor per day/);
    for (const p of ['/api/portfolio', '/api/portfolio/analyze', '/api/portfolio/schedule']) {
      const r = await fetch(base + p, { method: p === '/api/portfolio' ? 'GET' : 'POST' });
      assert.equal(r.status, 404, p);
    }
    const state = await (await fetch(base + '/api/state?artist=the-clash')).text();
    assert.ok(!UUID.test(state), 'Today payload: no entity ids');
  } finally {
    child.kill();
  }
});
