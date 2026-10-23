// Is the artist "quiet" right now? The card always says which basis was used.
//
// Why not Qloo trending: on the hackathon key (checked 2026-10-23, scripts/check-trending.js) the
// weekly series moves from Sep 2023 to Feb 2025, is empty from Mar to mid-Oct 2025, and since
// Oct 17 2025 every artist holds one repeated value. That value keeps the early-2025 order, so it
// says nothing about the last 90 days. We do not use it.
//
// Main basis, English Wikipedia page views (public, official Wikimedia API). Fixed on 2026-10-23,
// before the demo artist was re-checked:
//   window   the 36 complete months before the check date
//   A        no wake-up: no month in the last 24 above 1.5x the 36-month average
//            (the same rule the spec set for royalty statements)
//   B        not rising now: the last 3 complete months (about 90 days) at or below the 36-month average
//   quiet =  A and B. Months are compared as views per day, so month length does not matter.
//
// Fallback basis, the owner's royalty statements: rule A on monthly streams or royalties.
//
// Catalogue condition (added 2026-10-23, after the rank-blend score let current stars such as
// Taylor Swift and Lana Del Rey through): no new studio album in the last 5 years. Studio album =
// a MusicBrainz release group with primary type Album and no secondary type (so compilations,
// live albums, soundtracks, remixes, demos and the like do not count), leaving out groups that hold
// only bootleg, promotional or pseudo-releases. An artist we cannot find on
// MusicBrainz, or with no dated studio album there, is "unknown" and is not treated as quiet.
// The page-view rule only compares an artist with its own past; this part asks whether the artist
// is a catalogue act at all.
import { addMonths } from './wiki.js';

export const CATALOGUE_RULE = { years: 5, source: 'MusicBrainz release groups: primary type Album, no secondary type, not bootleg-only, not dated in the future' };

// albums: [{ title, date, primary, secondary }] or null when the artist was not found.
// Returns { old: true | false | null, latest: { title, date } | null, cutoff }.
export function catalogueFromAlbums(albums, asOf, rule = CATALOGUE_RULE) {
  const cutoff = `${Number(asOf.slice(0, 4)) - rule.years}${asOf.slice(4, 10)}`;
  if (!albums) return { old: null, latest: null, cutoff, why: 'not found on MusicBrainz' };
  // Release groups dated after asOf are not out yet (or are bad data), so they do not count as a new album.
  const studio = albums.filter((a) => a.primary === 'Album' && !(a.secondary || []).length && /^\d{4}/.test(a.date || '') && a.date <= asOf.slice(0, 10));
  if (!studio.length) return { old: null, latest: null, cutoff, why: 'no dated studio album on MusicBrainz' };
  const latest = studio.reduce((x, y) => (y.date > x.date ? y : x));
  // A partial date counts from the end of its year or month (the cautious side).
  const full = latest.date.length === 4 ? `${latest.date}-12-31` : latest.date.length === 7 ? `${latest.date}-31` : latest.date;
  return { old: full < cutoff, latest: { title: latest.title, date: latest.date }, cutoff };
}

// quiet = page-view rule (A and B) and the catalogue condition. Unknown catalogue: not quiet.
export function withCatalogue(q, cat) {
  if (!q || q.basis !== 'Wikipedia page views') return q;
  const year = cat?.latest?.date?.slice(0, 4);
  const catalogueText = cat?.old === true ? `Latest studio album: ${cat.latest.title} (${year}).`
    : cat?.old === false ? `New studio album in the last 5 years: ${cat.latest.title} (${year}).`
    : `Catalogue check unknown (${cat?.why || 'not checked'}), so not counted as quiet.`;
  return { ...q, pageviewsQuiet: q.quiet, catalogue: cat ? { old: cat.old, latest: cat.latest, why: cat.why || null } : { old: null, latest: null, why: 'not checked' }, quiet: q.quiet && cat?.old === true, detail: `${q.detail} ${catalogueText}` };
}

export const QUIET_RULE = { months: 36, noSpikeMonths: 24, spikeX: 1.5, recentMonths: 3, recentMaxX: 1, minMonths: 33 };

const daysIn = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const r2 = (v) => Math.round(v * 100) / 100;
const monthName = (ym) => new Date(ym + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

// The months the rule reads for a check on `asOf` (YYYY-MM-DD): the 36 complete months before it.
export function ruleWindow(asOf, rule = QUIET_RULE) {
  const last = addMonths(asOf.slice(0, 7), -1);
  return { from: addMonths(last, -(rule.months - 1)), to: last };
}

// monthly: [{ month: 'YYYY-MM', views }]. Returns null when there is too little history.
export function quietFromPageviews(monthly, asOf, rule = QUIET_RULE) {
  const { from, to } = ruleWindow(asOf, rule);
  const perDay = new Map();
  for (const m of monthly || []) if (m.month >= from && m.month <= to && Number.isFinite(m.views)) perDay.set(m.month, m.views / daysIn(m.month));
  if (perDay.size < rule.minMonths) return null;
  const months = [...perDay.keys()].sort();
  const avg = [...perDay.values()].reduce((s, v) => s + v, 0) / perDay.size;
  if (!avg) return null;
  const spikeFrom = addMonths(to, -(rule.noSpikeMonths - 1));
  const recentFrom = addMonths(to, -(rule.recentMonths - 1));
  let peakMonth = null, peak = -1;
  for (const m of months) if (m >= spikeFrom && perDay.get(m) > peak) { peak = perDay.get(m); peakMonth = m; }
  const recent = months.filter((m) => m >= recentFrom).map((m) => perDay.get(m));
  if (!recent.length) return null;
  const recentAvg = recent.reduce((s, v) => s + v, 0) / recent.length;
  const ratio = recentAvg / avg, peakRatio = peak / avg;
  const noWake = peakRatio <= rule.spikeX, notRising = ratio <= rule.recentMaxX;
  return {
    quiet: noWake && notRising,
    basis: 'Wikipedia page views',
    ratio: r2(ratio), ratioExact: ratio, peakRatio: r2(peakRatio), peakMonth, window: { from, to },
    noWake, notRising,
    detail: `Last 3 months at ${r2(ratio)}x its 36-month average. Busiest month in 2 years: ${r2(peakRatio)}x (${monthName(peakMonth)}).`,
  };
}

export function quietFromRoyalty(statements) {
  if (!statements?.months?.length || !statements.avg36) return null;
  const peak = Math.max(...statements.months.slice(-24));
  return { quiet: peak <= 1.5 * statements.avg36, basis: 'royalty statements', detail: `Busiest month in 2 years: ${(peak / statements.avg36).toFixed(2)}x the 36-month average.` };
}
