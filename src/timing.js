// "How many days are left" for a sync window. Every date carries "announced" or "estimated".
// Thresholds are ours (set before key day, adjustable): 14-60 days = best; under 14 = may be too
// late; over 60 = they may not be choosing music yet.
export const TRAILER_LEAD_DAYS = { live: 126, animation: 217 }; // Stephen Follows averages
export const MIN_DAYS = 14;
export const MAX_DAYS = 60;

const DAY = 86400000;
export const daysBetween = (fromISO, toISO) => Math.round((Date.parse(toISO + 'T00:00:00Z') - Date.parse(fromISO + 'T00:00:00Z')) / DAY);
export const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

function byDays(days) {
  if (days < MIN_DAYS) return { bucket: 'too-late', reason: `only ${days} days left, may be too late` };
  if (days > MAX_DAYS) return { bucket: 'early', reason: `${days} days out, they may not be choosing music yet` };
  return { bucket: 'in-window', reason: '' };
}

export function evaluateTiming(w, today) {
  if (!w.release) {
    return { bucket: 'unknown', date: w.releaseMonth || null, dateStatus: 'announced', daysLeft: null, event: 'Release (month only)', reason: 'release day not checked' };
  }
  if (w.kind === 'game') {
    const d = daysBetween(today, w.release);
    return { date: w.release, dateStatus: w.dateStatus, daysLeft: d, event: 'Release', ...byDays(d) };
  }
  if (w.kind === 'film') {
    const lead = w.animation ? TRAILER_LEAD_DAYS.animation : TRAILER_LEAD_DAYS.live;
    const est = addDays(w.release, -lead);
    const d = daysBetween(today, est);
    if (d < 0) return { date: est, dateStatus: 'estimated', daysLeft: d, event: 'First trailer', release: w.release, bucket: 'too-late', reason: 'the estimated first-trailer date has passed; it may be out or delayed' };
    return { date: est, dateStatus: 'estimated', daysLeft: d, event: 'First trailer', release: w.release, ...byDays(d) };
  }
  // series: no countdown, production status instead
  const d = daysBetween(today, w.release);
  const base = { date: w.release, dateStatus: w.dateStatus, daysLeft: null, event: 'Premiere', production: w.production };
  if (w.production === 'released' || d < 0) return { ...base, bucket: 'too-late', reason: 'already airing, the window is closed' };
  if (w.production === 'filming') return { ...base, bucket: 'early', reason: 'still filming, music comes later' };
  if (d <= MIN_DAYS) return { ...base, bucket: 'too-late', reason: `premieres in ${d} days, music is likely locked` };
  return { ...base, bucket: 'in-window', reason: '' };
}
