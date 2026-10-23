import test from 'node:test';
import assert from 'node:assert/strict';
import { similarTitlesBaseline, expectedPositives, normName } from '../src/baselines.js';
import { manualRecord } from '../src/pipeline.js';
import { classifyClearance } from '../src/clearance.js';
import { ARTISTS } from '../src/data/artists.js';

const windows = [{ id: 'a', kind: 'series' }, { id: 'b', kind: 'series' }, { id: 'c', kind: 'film' }];
const tracks = {
  a: { artists: ['The Cure', 'Pixies'], partial: false },
  b: { artists: ['Pixies', 'Blur'], partial: false },
  c: { artists: ['Blur', 'Oasis'], partial: true },
};
const pool = ['Oasis', 'Blur', 'Pixies', 'Cure', 'Muse'].map((name) => ({ name }));

test('name matching ignores case, accents, "the" and "&"', () => {
  assert.equal(normName('The Cure'), normName('cure'));
  assert.equal(normName('Simon & Garfunkel'), normName('Simon and Garfunkel'));
  assert.equal(normName('Björk'), normName('bjork'));
});

test('similar-titles baseline: own title first, then same-kind titles, other kinds ignored', () => {
  const b = similarTitlesBaseline(pool, ['a'], tracks, windows);
  // Pixies: own (2) + series b (1) = 3; Cure: own (2); Blur: series b (1); Oasis: film only (0, unranked)
  assert.deepEqual(b.byTitle.a, ['Pixies', 'Cure', 'Blur']);
});

test('expected positives = artists x pool coverage x (1 - repeat rate)', () => {
  const e = expectedPositives(pool, tracks, 0.5);
  assert.equal(e.a.artists, 2);
  assert.equal(e.a.inPool, 2);
  assert.equal(e.a.expected, 1);
  assert.equal(expectedPositives([{ name: 'Muse' }], tracks).a.coverage, 0);
});

test('viewer manual share overrides public data without touching the stored record', () => {
  const rec = manualRecord(ARTISTS['culture-club'], { publishingPct: 100, masterPct: 100 });
  assert.equal(classifyClearance(rec).category, 'one-stop');
  assert.equal(ARTISTS['culture-club'].clearance.manual, null);
  assert.equal(classifyClearance(manualRecord(ARTISTS['culture-club'], null)).category, 'unconfirmed');
});
