import test from 'node:test';
import assert from 'node:assert/strict';
import { percentileOf, assignBands, bandPercentiles, topPercent, spearman, kendallTau, auc, median, premiseVerdict, audienceOverlap } from '../src/scoring.js';

test('percentileOf counts ties as half', () => {
  assert.equal(percentileOf(3, [1, 2, 3, 4]), 62.5);
  assert.equal(percentileOf(5, [1, 2, 3, 4]), 100);
  assert.equal(percentileOf(0, []), null);
});

test('bands split the pool by popularity into equal groups', () => {
  const pool = Array.from({ length: 500 }, (_, i) => ({ id: 'a' + i, popularity: 1 - i / 1000 }));
  const bands = assignBands(pool, 10);
  const counts = new Array(10).fill(0);
  for (const b of bands.values()) counts[b]++;
  assert.deepEqual(counts, new Array(10).fill(50));
  assert.equal(bands.get('a0'), 0);
  assert.equal(bands.get('a499'), 9);
});

test('excess affinity is a percentile inside the band, not across the pool', () => {
  // Two bands. Popular band has high affinities, the other low. The best of the low band is still top of its band.
  const pool = [
    { id: 'p1', popularity: 0.99 }, { id: 'p2', popularity: 0.98 },
    { id: 'q1', popularity: 0.5 }, { id: 'q2', popularity: 0.4 },
  ];
  const aff = new Map([['p1', 0.9], ['p2', 0.8], ['q1', 0.3], ['q2', 0.1]]);
  const bp = bandPercentiles(pool, aff, 2);
  assert.equal(bp.get('q1').pct, 75);
  assert.equal(bp.get('p2').pct, 25);
  assert.equal(topPercent(bp.get('q1').pct), 25);
});

test('unscored artists get no percentile', () => {
  const pool = [{ id: 'x', popularity: 0.9 }, { id: 'y', popularity: 0.8 }];
  const bp = bandPercentiles(pool, new Map([['x', 0.5]]), 1);
  assert.equal(bp.get('y').pct, null);
  assert.equal(topPercent(null), null);
});

test('spearman and kendall on known cases', () => {
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  assert.equal(kendallTau([1, 2, 3], [1, 2, 3]), 1);
  assert.equal(kendallTau([1, 2, 3], [3, 2, 1]), -1);
  assert.ok(Math.abs(kendallTau([1, 2, 3, 4], [1, 3, 2, 4]) - 2 / 3) < 1e-9);
});

test('auc and median', () => {
  assert.equal(auc([0.9, 0.8, 0.2, 0.1], [1, 1, 0, 0]), 1);
  assert.equal(auc([0.1, 0.2, 0.8, 0.9], [1, 1, 0, 0]), 0);
  assert.equal(auc([0.5, 0.5], [1, 0]), 0.5);
  assert.equal(auc([1, 2], [1, 1]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});

test('premise verdict follows the fixed bars', () => {
  assert.equal(premiseVerdict([0.1, 0.3, 0.2], [0.2]).verdict, 'pass');
  assert.equal(premiseVerdict([0.9, 0.85, 0.95], [0.1]).verdict, 'fail');
  assert.equal(premiseVerdict([0.6, 0.7, 0.65], [0.3]).verdict, 'pass');
  assert.equal(premiseVerdict([0.6, 0.7, 0.65], [0.6]).verdict, 'fail');
  assert.equal(premiseVerdict([0.1, 0.2], [0.85]).verdict, 'fail');
});

test('audience overlap: identical = 1, opposite skews < identical, missing = null', () => {
  const young = { age: { '24_and_younger': 0.5, '25_to_29': 0.3, '30_to_34': 0, '35_to_44': -0.2, '45_to_54': -0.4, '55_and_older': -0.5 }, gender: { male: 0.3, female: -0.3 } };
  const old = { age: { '24_and_younger': -0.5, '25_to_29': -0.4, '30_to_34': -0.2, '35_to_44': 0, '45_to_54': 0.3, '55_and_older': 0.5 }, gender: { male: -0.3, female: 0.3 } };
  assert.ok(Math.abs(audienceOverlap(young, young) - 1) < 1e-9);
  const o = audienceOverlap(young, old);
  assert.ok(o > 0 && o < 0.8);
  assert.equal(audienceOverlap(young, null), null);
});
