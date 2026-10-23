import test from 'node:test';
import assert from 'node:assert/strict';
import { quietFromPageviews, ruleWindow, quietFromRoyalty, catalogueFromAlbums, withCatalogue } from '../src/quiet.js';
import { addMonths, wikidataOf } from '../src/wiki.js';

// 40 months ending Sep 2026, views per month from a function of the month index (0 = oldest).
const series = (f) => Array.from({ length: 40 }, (_, i) => ({ month: addMonths('2023-06', i), views: f(i) }));

test('rule window: the 36 complete months before the check date', () => {
  assert.deepEqual(ruleWindow('2026-10-23'), { from: '2023-10', to: '2026-09' });
  assert.deepEqual(ruleWindow('2026-01-01'), { from: '2023-01', to: '2025-12' });
});

test('slow decline, no spike: quiet', () => {
  const q = quietFromPageviews(series((i) => 30000 - 200 * i), '2026-10-23');
  assert.equal(q.quiet, true);
  assert.equal(q.basis, 'Wikipedia page views');
  assert.ok(q.ratio < 1 && q.peakRatio <= 1.5);
});

test('one month above 1.5x in the last 24: not quiet (a wake-up)', () => {
  const q = quietFromPageviews(series((i) => (addMonths('2023-06', i) === '2025-07' ? 70000 : 30000)), '2026-10-23');
  assert.equal(q.quiet, false);
  assert.equal(q.noWake, false);
  assert.equal(q.peakMonth, '2025-07');
});

test('a spike older than 24 months does not count', () => {
  const q = quietFromPageviews(series((i) => (addMonths('2023-06', i) === '2024-03' ? 90000 : 30000 - 100 * i)), '2026-10-23');
  assert.equal(q.noWake, true);
  assert.equal(q.quiet, true);
});

test('rising last 3 months (above the 36-month average): not quiet', () => {
  const q = quietFromPageviews(series((i) => (i >= 37 ? 40000 : 30000)), '2026-10-23');
  assert.equal(q.notRising, false);
  assert.equal(q.quiet, false);
});

test('views are compared per day, so a short February is not a dip', () => {
  const q = quietFromPageviews(series((i) => 1000 * Number(new Date(Date.UTC(2023, 5 + i + 1, 0)).getUTCDate())), '2026-10-23');
  assert.equal(q.ratio, 1);
  assert.equal(q.peakRatio, 1);
});

test('too little history: no verdict', () => {
  assert.equal(quietFromPageviews(series(() => 100).slice(-20), '2026-10-23'), null);
  assert.equal(quietFromPageviews([], '2026-10-23'), null);
});

test('royalty fallback keeps the 1.5x rule', () => {
  assert.equal(quietFromRoyalty({ months: [10, 11, 12], avg36: 10 }).quiet, true);
  assert.equal(quietFromRoyalty({ months: [10, 16], avg36: 10 }).quiet, false);
});

const album = (title, date, secondary = []) => ({ title, date, primary: 'Album', secondary });

test('catalogue: latest studio album older than 5 years is old; compilations and live albums do not count', () => {
  const c = catalogueFromAlbums([album('Last studio', '1985-11-04'), album('Hits', '2024-05-01', ['Compilation']), album('Live', '2023', ['Live']), { title: 'Single', date: '2025-01-01', primary: 'Single', secondary: [] }], '2026-10-23');
  assert.equal(c.old, true);
  assert.deepEqual(c.latest, { title: 'Last studio', date: '1985-11-04' });
  assert.equal(c.cutoff, '2021-10-23');
});

test('catalogue: a studio album in the last 5 years is recent; a year-only date counts from year end', () => {
  assert.equal(catalogueFromAlbums([album('Old', '2010'), album('New', '2025-10-03')], '2026-10-23').old, false);
  assert.equal(catalogueFromAlbums([album('Edge', '2021')], '2026-10-23').old, false);
  assert.equal(catalogueFromAlbums([album('Edge', '2021-10-22')], '2026-10-23').old, true);
});

test('catalogue: release groups dated after asOf are ignored (not out yet, or bad data)', () => {
  const c = catalogueFromAlbums([album('Last studio', '1969-09-26'), album('Bad record', '2026-11-24')], '2026-10-23');
  assert.equal(c.old, true);
  assert.equal(c.latest.title, 'Last studio');
  assert.equal(catalogueFromAlbums([album('Next', '2027-02-01')], '2026-10-23').old, null);
});

test('catalogue: not found, or no dated studio album, is unknown and never quiet', () => {
  assert.equal(catalogueFromAlbums(null, '2026-10-23').old, null);
  assert.equal(catalogueFromAlbums([album('Hits', '1990', ['Compilation']), album('Undated', '')], '2026-10-23').old, null);
  const pv = quietFromPageviews(series((i) => 30000 - 200 * i), '2026-10-23');
  assert.equal(pv.quiet, true);
  assert.equal(withCatalogue(pv, catalogueFromAlbums(null, '2026-10-23')).quiet, false);
  assert.equal(withCatalogue(pv, catalogueFromAlbums([album('New', '2025-10-03')], '2026-10-23')).quiet, false);
  const ok = withCatalogue(pv, catalogueFromAlbums([album('Old', '1985')], '2026-10-23'));
  assert.equal(ok.quiet, true);
  assert.equal(ok.pageviewsQuiet, true);
  assert.match(ok.detail, /Latest studio album: Old \(1985\)/);
});

test('wikidata id is read from both Qloo shapes', () => {
  assert.equal(wikidataOf({ properties: { external: { wikidata: { id: 'q488916' } } } }), 'Q488916');
  assert.equal(wikidataOf({ external: { wikidata: [{ id: 'q1' }] } }), 'Q1');
  assert.equal(wikidataOf({}), null);
});
