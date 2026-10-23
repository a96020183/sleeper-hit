import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalJSON, sha256, writeSeal, verifySealFile, encrypt, decrypt, unsealView } from '../src/seal.js';

test('canonical JSON ignores key order, so the hash is stable', () => {
  assert.equal(canonicalJSON({ b: 1, a: [2, { d: 1, c: 2 }] }), canonicalJSON({ a: [2, { c: 2, d: 1 }], b: 1 }));
  assert.equal(sha256(canonicalJSON({ b: 1, a: 2 })), sha256(canonicalJSON({ a: 2, b: 1 })));
});

test('sha256 matches a known vector', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('seal files verify, and any change breaks the hash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seal-'));
  const files = { 'pool.json': { artists: ['A', 'B'] }, 'ranks.json': { titles: { t: [1, 2] } }, 'baselines.json': { popularity: ['B', 'A'] } };
  const hashes = writeSeal(dir, files);
  assert.equal(hashes.length, 3);
  for (const h of hashes) assert.equal(verifySealFile(dir, h.file, h.sha256).ok, true);
  fs.writeFileSync(path.join(dir, 'pool.json'), canonicalJSON({ artists: ['A', 'C'] }));
  assert.equal(verifySealFile(dir, 'pool.json', hashes[0].sha256).ok, false);
});

test('encrypted seal: hash is over the plaintext, wrong password fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seal-enc-'));
  const hashes = writeSeal(dir, { 'ranks.json': { x: 1 } }, { password: 'pw' });
  assert.ok(fs.existsSync(path.join(dir, 'ranks.json.enc')));
  assert.ok(!fs.existsSync(path.join(dir, 'ranks.json')));
  assert.equal(verifySealFile(dir, 'ranks.json', hashes[0].sha256, { password: 'pw' }).ok, true);
  assert.throws(() => decrypt(encrypt(Buffer.from('hi'), 'a'), 'b'));
});

test('unseal view drops raw Qloo values and ids', () => {
  const v = unsealView({ sealedAt: 'x', titles: { t: [{ name: 'A', id: 'ID', rank: 1, affinityRank: 3, popularityRank: 2, bandPct: 99.5, excessRank: 4, affinity: 0.8, popularity: 0.99 }] } });
  assert.deepEqual(v.titles.t[0], { artist: 'A', rank: 1, affinityRank: 3, popularityRank: 2, bandPercentile: 99.5, excessRank: 4 });
  assert.equal(JSON.stringify(v).includes('ID'), false);
});
