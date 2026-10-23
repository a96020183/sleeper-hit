// Client tests run against the offline mock or a fake fetch: no network, no key needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { QlooClient } from '../src/qloo/client.js';
import { QlooHttp } from '../src/qloo/http.js';
import { runArtist } from '../src/pipeline.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qloo-'));

test('mock client resolves exact names only and reports ambiguity', async () => {
  const c = new QlooClient({ mode: 'mock', cacheRoot: tmp() });
  const a = await c.resolve({ query: 'Air Supply', type: 'urn:entity:artist' });
  assert.equal(a.name, 'Air Supply');
  await assert.rejects(c.resolve({ query: 'Air Sup', type: 'urn:entity:artist' }), /No exact Qloo match/);
});

test('mock pool comes back in popularity order and scoring works in chunks', async () => {
  const c = new QlooClient({ mode: 'mock', cacheRoot: tmp() });
  const pool = await c.buildPool(120);
  assert.equal(pool.length, 120);
  for (let i = 1; i < pool.length; i++) assert.ok(pool[i - 1].popularity >= pool[i].popularity);
  const sig = await c.resolve({ query: 'Grand Theft Auto V', type: 'urn:entity:videogame', year: '2014' });
  const scored = await c.scoreArtists(sig.id, pool.map((p) => p.id));
  assert.equal(scored.size, 120);
});

test('http layer sends the key only as a header, never logs or caches it, and caches responses privately', async () => {
  const dir = tmp();
  let seen;
  const fakeFetch = async (url, opts) => {
    seen = { url: String(url), headers: opts.headers };
    return { status: 200, headers: { get: (k) => (k === 'x-month-ratelimit-remaining' ? '4000' : null) }, json: async () => ({ success: true, results: [] }) };
  };
  const h = new QlooHttp({ base: 'https://hackathon.api.qloo.com', key: 'SECRET-KEY-123', cacheDir: path.join(dir, 'cache'), reqPerSec: 100, fetchImpl: fakeFetch });
  await h.get('/search', { query: 'x', types: 'urn:entity:artist' });
  assert.equal(seen.headers['X-Api-Key'], 'SECRET-KEY-123');
  assert.ok(!seen.url.includes('SECRET'));
  const files = fs.readdirSync(path.join(dir, 'cache'));
  assert.equal(files.length, 1);
  const everything = files.map((f) => fs.readFileSync(path.join(dir, 'cache', f), 'utf8')).join('') + fs.readFileSync(path.join(dir, 'calllog.jsonl'), 'utf8');
  assert.ok(!everything.includes('SECRET'));
  await h.get('/search', { types: 'urn:entity:artist', query: 'x' }); // same params, other order -> cache hit
  assert.equal(h.stats.cached, 1);
});

test('http layer stops live calls under the monthly floor and surfaces HTTP errors', async () => {
  const fetch403 = async () => ({ status: 403, headers: { get: (k) => (k === 'x-month-ratelimit-remaining' ? '10' : null) }, json: async () => ({ message: 'no access' }) });
  const h = new QlooHttp({ base: 'https://x', key: 'k', cacheDir: path.join(tmp(), 'c'), reqPerSec: 100, monthlyFloor: 50, fetchImpl: fetch403 });
  await assert.rejects(h.get('/v2/insights', { a: 1 }), /HTTP 403/);
  await assert.rejects(h.get('/v2/insights', { a: 2 }), /below the floor/);
});

test('agent run on mock data returns derived values only', async () => {
  const c = new QlooClient({ mode: 'mock', cacheRoot: tmp() });
  const s = await runArtist(c, 'air-supply', '2026-10-22');
  assert.equal(s.doors.length, 5);
  assert.ok(s.doors.filter((d) => d.action === 'letter').length <= 3);
  for (const d of s.doors) if (d.action === 'skip') assert.ok(d.reason.length > 0);
  const json = JSON.stringify(s);
  assert.ok(!/"affinity"|"popularity"|"signalId"|"entity_id"|"wikidata"/.test(json));
  assert.equal(s.quiet.basis, 'Wikipedia page views'); // mock Wikimedia, no network
  assert.equal(typeof s.quiet.quiet, 'boolean');
  assert.ok(s.quiet.catalogue && 'old' in s.quiet.catalogue); // mock MusicBrainz, no network
  if (s.quiet.quiet) assert.equal(s.quiet.catalogue.old, true);
  const cc = await runArtist(c, 'culture-club', '2026-10-22');
  assert.ok(cc.doors.every((d) => d.action === 'skip' && /unconfirmed/i.test(d.reason)));
});
