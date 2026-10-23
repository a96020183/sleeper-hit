import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreRanking, positivesFor, totals, backtestVerdict, settleVerdict } from '../src/evaluate.js';
import { settle } from '../src/settle.js';

const pool = ['A', 'B', 'C', 'D', 'E', 'F'];

test('scoreRanking: hits in the top K and AUC; unranked names tie at the bottom', () => {
  const full = scoreRanking(pool, ['B', 'A', 'C', 'D', 'E', 'F'], ['B', 'C'], 2);
  assert.equal(full.hits, 1);
  assert.deepEqual(full.hitNames, ['B']);
  assert.equal(full.auc, 7 / 8); // B beats all 4 negatives, C beats D, E, F
  const short = scoreRanking(pool, ['B'], ['B', 'C'], 2);
  assert.equal(short.hits, 1);
  assert.equal(short.auc, (4 + 2) / 8); // C ties with all 4 negatives
});

test('positives: pool artists in the list, minus exclusions; names normalised', () => {
  assert.deepEqual(positivesFor(['The Cure', 'Blur', 'Oasis'], ['cure', 'Oasis', 'Pulp'], ['oasis']), ['The Cure']);
});

test('backtest verdict needs more hits than both popularity and the LLM', () => {
  const t = (q, l, p) => ({ qloo: { hits: q }, llm: { hits: l }, popularity: { hits: p } });
  assert.equal(backtestVerdict(t(3, 2, 1), 5).verdict, 'qloo-ahead');
  assert.equal(backtestVerdict(t(2, 2, 1), 5).verdict, 'qloo-not-ahead');
  assert.equal(backtestVerdict(t(0, 0, 1), 5).verdict, 'qloo-not-ahead');
  assert.equal(backtestVerdict(t(1, 0, 0), 0).verdict, 'no-data');
  assert.equal(backtestVerdict({ qloo: { hits: 1 }, popularity: { hits: 0 } }, 3).verdict, 'incomplete');
  assert.deepEqual(totals([{ methods: { qloo: { hits: 1, auc: 0.6 } } }, { methods: { qloo: { hits: 2, auc: 0.4 } } }], ['qloo']).qloo, { hits: 3, meanAuc: 0.5 });
});

test('settlement verdict follows the spec bars', () => {
  assert.equal(settleVerdict({ positives: 9, qloo: 0.9, popularity: 0.5, llm: 0.5, similarTitles: 0.5 }).verdict, 'too-few');
  assert.equal(settleVerdict({ positives: 12, qloo: 0.7, popularity: 0.6, llm: 0.6, similarTitles: 0.6 }).verdict, 'pass');
  assert.equal(settleVerdict({ positives: 12, qloo: 0.7, popularity: 0.72, llm: 0.6, similarTitles: 0.6 }).verdict, 'fail');
  assert.equal(settleVerdict({ positives: 12, qloo: 0.54, popularity: 0.5, llm: 0.5, similarTitles: 0.5 }).verdict, 'fail');
  assert.equal(settleVerdict({ positives: 12, qloo: 0.6, popularity: 0.5, llm: 0.5, similarTitles: 0.5 }).verdict, 'unsteady');
});

test('settle: excludes earlier-title and pre-seal artists, pools AUC by positives', () => {
  const sealPool = pool.map((name) => ({ name }));
  const ranks = { titles: { t: pool.map((name, i) => ({ name, rank: i + 1, bandPct: 100 - i })) } };
  const baselines = { popularity: { ranking: [...pool].reverse() }, llm: { byTitle: { t: ['F'] } }, similarTitles: { byTitle: {} } };
  const r = settle({ pool: sealPool, ranks, baselines, lists: { t: { artists: ['A', 'B', 'E'], source: 'x' } }, priorLists: { t: { artists: ['E'] } }, knownBeforeSeal: { t: ['B'] } });
  assert.equal(r.positives, 1); // only A counts
  assert.equal(r.perTitle[0].methods.qloo.auc, 1);
  assert.equal(r.pooledAuc.popularity, 0);
  assert.equal(r.verdict, 'too-few');
});
