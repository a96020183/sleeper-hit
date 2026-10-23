import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, compareDoors, DAILY_CAP } from '../src/agent.js';
import { classifyClearance } from '../src/clearance.js';
import { evaluateTiming, addDays } from '../src/timing.js';
import { ARTISTS } from '../src/data/artists.js';

const cl = (category) => ({ category, reason: category === 'unconfirmed' ? 'No source.' : '', paths: {} });
const tm = (bucket, dateStatus = 'announced', reason = '') => ({ bucket, dateStatus, reason, event: 'Release', date: '2026-11-19' });
const door = (id, category, bucket, pct, extra = {}) => ({ id, clearance: cl(category), timing: tm(bucket, extra.dateStatus, extra.reason), pct, overlap: extra.overlap ?? null });

test('ranking: clearance first, then timing, announced before estimated, then percentile, then overlap', () => {
  const doors = [
    door('consent-best', 'needs-consent', 'in-window', 99),
    door('cover-est', 'cover', 'in-window', 90, { dateStatus: 'estimated' }),
    door('cover-ann-low', 'cover', 'in-window', 60),
    door('cover-ann-high', 'cover', 'in-window', 80),
    door('onestop-early', 'one-stop', 'early', 99, { reason: '90 days out' }),
    door('onestop', 'one-stop', 'in-window', 55),
  ];
  const order = [...doors].sort(compareDoors).map((d) => d.id);
  assert.deepEqual(order, ['onestop', 'onestop-early', 'cover-ann-high', 'cover-ann-low', 'cover-est', 'consent-best']);
  const tie = [door('a', 'cover', 'in-window', 70, { overlap: 0.6 }), door('b', 'cover', 'in-window', 70, { overlap: 0.9 })];
  assert.deepEqual([...tie].sort(compareDoors).map((d) => d.id), ['b', 'a']);
});

test('unconfirmed clearance never gets a letter', () => {
  const out = decide([door('x', 'unconfirmed', 'in-window', 99)]);
  assert.equal(out[0].action, 'skip');
  assert.match(out[0].reason, /Clearance unconfirmed/);
});

test('outside the top-20% bar is skipped with the reason', () => {
  const out = decide([door('x', 'cover', 'in-window', 66)]);
  assert.equal(out[0].action, 'skip');
  assert.match(out[0].reason, /top 34%.*top 20%/);
  assert.equal(decide([door('y', 'cover', 'in-window', 81)])[0].action, 'letter');
});

test('an artist that is not quiet gets no letters, but a person can knock anyway', () => {
  const out = decide([door('x', 'cover', 'in-window', 99), door('y', 'cover', 'too-late', 99, { reason: 'too late' })], { block: 'Not quiet.', overrides: new Set(['z']) });
  assert.ok(out.every((d) => d.action === 'skip'));
  assert.equal(out.find((d) => d.id === 'x').reason, 'Not quiet.');
  assert.equal(out.find((d) => d.id === 'y').reason, 'Not quiet.');
  const flipped = decide([door('x', 'cover', 'in-window', 99)], { block: 'Not quiet.', overrides: new Set(['x']) });
  assert.equal(flipped[0].action, 'letter');
});

test('timing outside the window is skipped with its reason', () => {
  const out = decide([door('x', 'cover', 'too-late', 90, { reason: 'premieres in 10 days, music is likely locked' })]);
  assert.equal(out[0].action, 'skip');
  assert.equal(out[0].reason, 'Premieres in 10 days, music is likely locked.');
});

test(`at most ${DAILY_CAP} letters a day; the rest wait with a reason`, () => {
  const doors = Array.from({ length: 5 }, (_, i) => door('d' + i, 'cover', 'in-window', 95 - i));
  const out = decide(doors);
  assert.equal(out.filter((d) => d.action === 'letter').length, DAILY_CAP);
  assert.match(out.find((d) => d.id === 'd4').reason, /Already 3 letters today/);
});

test('a person can flip a skipped door back, and it is marked', () => {
  const out = decide([door('x', 'cover', 'in-window', 20)], { overrides: new Set(['x']) });
  assert.equal(out[0].action, 'letter');
  assert.equal(out[0].overridden, true);
});

test('clearance: no source -> unconfirmed; two controllers without manual -> unconfirmed', () => {
  assert.equal(classifyClearance({ publishing: { controllers: [] }, master: { controllers: [] } }).category, 'unconfirmed');
  const two = { publishing: { controllers: [{ name: 'A', share: 50, source: 'Songview' }, { name: 'B', share: 50, source: 'Songview' }] }, master: { controllers: [{ name: 'L', source: '(P) line' }] } };
  const c = classifyClearance(two);
  assert.equal(c.category, 'unconfirmed');
  assert.match(c.reason, /more than one controller/);
  assert.equal(classifyClearance({ publishing: { controllers: [{ name: 'A', share: 100, source: 'Songview' }], songviewChecked: false }, master: { controllers: [] } }).category, 'unconfirmed');
});

test('clearance: one company on both sides = one-stop; single publisher = cover', () => {
  const same = { publishing: { controllers: [{ name: 'X', share: 100, source: 'Songview' }] }, master: { controllers: [{ name: 'X', source: '(P) line' }] } };
  assert.equal(classifyClearance(same).category, 'one-stop');
  const split = { publishing: { controllers: [{ name: 'X', share: 100, source: 'Songview' }] }, master: { controllers: [{ name: 'Y', source: '(P) line' }] } };
  assert.equal(classifyClearance(split).category, 'cover');
});

test('clearance: Air Supply demo follows DMN plus manual input', () => {
  const c = classifyClearance(ARTISTS['air-supply'].clearance);
  assert.equal(c.category, 'cover');
  assert.equal(c.paths.original.ok, false);
  assert.match(c.paths.cover.text, /70%.*30% is unconfirmed/);
  assert.deepEqual(c.sources, ['DMN 2020', 'Manual']);
});

test('timing: estimated first trailer, series status, thresholds', () => {
  const sonic = evaluateTiming({ kind: 'film', animation: false, release: '2027-03-19', dateStatus: 'announced' }, '2026-10-22');
  assert.equal(sonic.date, '2026-11-13');
  assert.equal(sonic.dateStatus, 'estimated');
  assert.equal(sonic.bucket, 'in-window');
  const passed = evaluateTiming({ kind: 'film', animation: true, release: '2027-02-15', dateStatus: 'announced' }, '2026-10-22');
  assert.equal(passed.bucket, 'too-late');
  const game = evaluateTiming({ kind: 'game', release: '2026-11-19', dateStatus: 'announced' }, '2026-10-22');
  assert.equal(game.daysLeft, 28);
  assert.equal(game.bucket, 'in-window');
  const series = evaluateTiming({ kind: 'series', release: '2026-11-05', dateStatus: 'announced', production: 'post-production' }, '2026-10-22');
  assert.equal(series.bucket, 'too-late');
  assert.equal(series.daysLeft, null);
  // Series: episode music is treated as locked within 60 days of the premiere.
  assert.equal(evaluateTiming({ kind: 'series', release: '2026-11-20', dateStatus: 'announced', production: 'post-production' }, '2026-10-24').bucket, 'too-late');
  assert.equal(evaluateTiming({ kind: 'series', release: '2027-02-20', dateStatus: 'announced', production: 'post-production' }, '2026-10-24').bucket, 'in-window');
  assert.match(game.use, /Launch trailer/);
  assert.equal(evaluateTiming({ kind: 'game', release: addDays('2026-10-22', 90), dateStatus: 'announced' }, '2026-10-22').bucket, 'early');
});

test('clearance: a share with no known controller and no manual input -> unconfirmed', () => {
  const c = classifyClearance(ARTISTS['iggy-pop'].clearance);
  assert.equal(c.category, 'unconfirmed');
  assert.match(c.reason, /Co-writers/);
});

test('clearance: The Verve demo = cover through one administering publisher, original needs the label', () => {
  const c = classifyClearance(ARTISTS['the-verve'].clearance);
  assert.equal(c.category, 'cover');
  assert.match(c.paths.cover.text, /administered by Universal Music Publishing Group/);
  assert.equal(c.paths.original.ok, false);
  assert.ok(!ARTISTS['the-verve'].songs.includes('Bitter Sweet Symphony'));
});

test('letters state only sourced clearance facts', async () => {
  const { letterFacts, templateLetter } = await import('../src/letter.js');
  const mk = (key) => {
    const c = classifyClearance(ARTISTS[key].clearance);
    const door = { window: { title: 'T', season: '', earlier: { label: 'E' }, sceneHint: '' }, recipient: 'R', clearance: c, topPct: 5, overlap: null };
    return templateLetter(letterFacts({ artist: ARTISTS[key], door }));
  };
  const verve = mk('the-verve');
  assert.match(verve, /Universal Music Publishing Group administers the song, so a cover needs one licence request\. The original recording needs a separate OK/);
  assert.doesNotMatch(verve, /cleared in one call|five business days|we control/i);
  const air = mk('air-supply');
  assert.match(air, /We hold 70% of the publishing; the other 30% is not yet confirmed\./);
  assert.doesNotMatch(air, /confirming the rest now/);
});

test('clearance: The Clash demo = cover through the publisher that lists the songs; letter stays careful', async () => {
  const c = classifyClearance(ARTISTS['the-clash'].clearance);
  assert.equal(c.category, 'cover');
  assert.equal(c.paths.original.ok, false);
  assert.match(c.paths.cover.text, /listed by Universal Music Publishing Group/);
  const { letterFacts, templateLetter } = await import('../src/letter.js');
  const door = { window: { title: 'T', season: '', earlier: { label: 'E' }, sceneHint: '' }, recipient: 'R', clearance: c, topPct: 1, overlap: null };
  const text = templateLetter(letterFacts({ artist: ARTISTS['the-clash'], door }));
  assert.match(text, /lists the song in its catalogue, so a cover or trailer re-record should need one licence request; we would confirm its share before quoting./);
  assert.ok(!ARTISTS['the-clash'].songs.includes('This Is England')); // Cut the Crap: Strummer share at Warner Chappell
});

test('without Qloo: popularity-only decision swaps the card score for popularity rank', async () => {
  const { popularityOnly } = await import('../src/pipeline.js');
  const scored = { doors: [{ id: 'x', pct: 99, blend: { rank: 1, affinityRank: 1, popularityRank: 500, of: 1000 } }, { id: 'y', pct: null, blend: null }] };
  const p = popularityOnly(scored);
  assert.equal(Math.round(p.doors[0].pct), 50);
  assert.equal(p.doors[1].pct, null);
});

test('the letter cites the audience (affinity) rank, not the blended score', async () => {
  const { letterFacts, templateLetter } = await import('../src/letter.js');
  const c = classifyClearance(ARTISTS['the-clash'].clearance);
  const door = { window: { title: 'T', season: '', kind: 'game', earlier: { label: 'E' }, sceneHint: '' }, recipient: 'R', clearance: c, topPct: 1, overlap: null, blend: { affinityRank: 1, of: 2992 } };
  const text = templateLetter(letterFacts({ artist: ARTISTS['the-clash'], door }));
  assert.match(text, /E fans rank them No\. 1 of about 3,000 well-known artists by affinity/);
  assert.match(text, /a launch trailer or TV spot for T/);
});

test('timing: a final season does not suggest a next season', () => {
  const t = evaluateTiming({ kind: 'series', season: 'Season 4 (final)', release: '2026-11-20', dateStatus: 'announced', production: 'post-production' }, '2026-10-24');
  assert.equal(t.bucket, 'too-late');
  assert.doesNotMatch(t.reason, /next season/);
});
