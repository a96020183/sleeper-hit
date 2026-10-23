import test from 'node:test';
import assert from 'node:assert/strict';
import { creditsInPool, parseTudum } from '../src/answerkey.js';
import { pooledAuc, clusterBootstrap } from '../src/evaluate.js';

test('credits match whole first, then split (never on "and")', () => {
  const pool = ['Mumford & Sons', 'Daft Punk', 'Pharrell Williams', 'Bruno Mars', 'Mark Ronson', 'Simon and Garfunkel'];
  assert.deepEqual(creditsInPool(['Mumford & Sons'], pool), ['Mumford & Sons']);
  assert.deepEqual(creditsInPool(['Mark Ronson feat. Bruno Mars'], pool).sort(), ['Bruno Mars', 'Mark Ronson']);
  assert.deepEqual(creditsInPool(['Daft Punk featuring Pharrell Williams and Nile Rodgers'], pool), ['Daft Punk']);
  assert.deepEqual(creditsInPool(['Simon and Garfunkel'], pool), ['Simon and Garfunkel']);
});

test('Tudum formats: season filter, covers, numbered lists, heading then artist', () => {
  const st = ['Season 1', 'Season 2', 'Season 1', '“Africa” Toto', 'Season 2', '“Whip It” Devo'];
  assert.deepEqual(parseTudum(st, { format: 'songThenArtist', seasons: [2] }), ['Devo']);
  const obx = ['Episode 101', 'alt-J “Left Hand Free”', 'Episode 201', 'Joy Oladokon “Out on the Weekend (Neil Young cover)”'];
  assert.deepEqual(parseTudum(obx, { format: 'artistThenSong', seasons: [2] }), ['Joy Oladokon', 'Neil Young']);
  assert.deepEqual(parseTudum(['1. Selena Gomez – “In the Dark”'], { format: 'numberedList' }), ['Selena Gomez']);
  const b = ['“Yellow”', '(Coldplay) by Vitamin String Quartet', '“Losing My Religion”', 'R.E.M. (covered by GnusCello)', '“Bad Moon Rising”', 'Creedence Clearwater Revival (covered by cast)'];
  assert.deepEqual(parseTudum(b, { format: 'headingThenArtist' }), ['Coldplay', 'Vitamin String Quartet', 'R.E.M.', 'GnusCello', 'Creedence Clearwater Revival']);
});

test('pooled AUC is positives-weighted and the bootstrap is reproducible', () => {
  assert.equal(pooledAuc([{ auc: 1, positives: 3 }, { auc: 0.5, positives: 1 }, { auc: null, positives: 2 }]), 0.875);
  const pairs = [1, 2, 3, 4].map((i) => ({ franchise: `f${i % 3}`, v: i }));
  const f = { mean: (ps) => ps.reduce((s, p) => s + p.v, 0) / ps.length };
  const a = clusterBootstrap(pairs, f, { reps: 500 }), b = clusterBootstrap(pairs, f, { reps: 500 });
  assert.deepEqual(a, b);
  assert.equal(a.mean.value, 2.5);
  assert.ok(a.mean.lo <= 2.5 && a.mean.hi >= 2.5);
});
