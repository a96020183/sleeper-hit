// Clearance category from public rights data plus the rights holder's own input.
// Qloo has no rights data. Publishing comes from Songview (or press reports), masters from the
// (P) line / Discogs / MusicBrainz, and manual input overrides both. Rules (fixed):
//   - No source at all -> "unconfirmed"; the card shows no category.
//   - Songview consulted but the work is not reconciled -> "unconfirmed".
//   - Two or more controllers on either side and no manual confirmation -> "unconfirmed".
//   - Part of a side with no known controller (e.g. a co-writer's share) and no manual input -> "unconfirmed".
//   - Public data and manual input disagree -> manual wins, and the card says "Manual".
//   - Unconfirmed doors get no letter.
// Categories are for prioritising. They are not legal advice.

export const CATEGORY_RANK = { 'one-stop': 0, cover: 1, 'needs-consent': 2, unconfirmed: 3 };
export const CATEGORY_LABEL = {
  'one-stop': 'One-stop: one party clears song and recording',
  cover: 'Cover clearable: needs the song only',
  'needs-consent': 'Needs another party\'s consent',
  unconfirmed: 'Unconfirmed',
};

const named = (list) => (list || []).filter((c) => c.name);
const sourced = (list) => (list || []).filter((c) => c.source);

export function classifyClearance(record) {
  const pub = record?.publishing || { controllers: [] };
  const mas = record?.master || { controllers: [] };
  const manual = record?.manual || null;
  const sources = [...new Set([...sourced(pub.controllers), ...sourced(mas.controllers)].map((c) => c.source))];
  if (manual) sources.push('Manual');

  const unconfirmed = (reason) => ({ category: 'unconfirmed', label: CATEGORY_LABEL.unconfirmed, reason, sources, manual: !!manual, paths: {} });

  if (!sources.length) return unconfirmed('No public source found yet. Check Songview and the (P) line, or enter your own share.');
  if (pub.songviewChecked === false && !manual) return unconfirmed('The work is not reconciled in Songview.');

  const pubCount = named(pub.controllers).length;
  const masCount = mas.multipleControllers ? 2 : named(mas.controllers).length;
  if (!manual && (pubCount >= 2 || masCount >= 2)) {
    const side = pubCount >= 2 ? `publishing has ${pubCount} controllers` : 'the recording has more than one controller';
    return unconfirmed(`Found more than one controller (${side}). Confirm before knocking.`);
  }

  const unknownShares = [...(pub.controllers || []), ...(mas.controllers || [])].filter((c) => !c.name);
  if (!manual && unknownShares.length) {
    return unconfirmed(unknownShares[0].note || 'Part of the song or recording has no known controller. Confirm before knocking.');
  }

  const paths = {};
  if (manual) {
    const p = Number(manual.publishingPct) || 0;
    const m = Number(manual.masterPct) || 0;
    const unknownPub = (pub.controllers || []).filter((c) => !c.name).reduce((s, c) => s + (c.share || 0), 0);
    paths.original = p >= 100 && m >= 100
      ? { ok: true, text: 'Original: you control both song and recording.' }
      : { ok: false, text: `Original: needs the recording owner's consent${mas.controllers?.[0]?.name ? ` (${mas.controllers[0].name})` : ''}.` };
    if (p >= 100) paths.cover = { ok: true, text: 'Cover: needs the song only, and you control all of it.' };
    else if (p >= 50) paths.cover = { ok: true, caveat: true, text: `Cover: needs the song only. You hold ${p}%; ${unknownPub || 100 - p}% is unconfirmed.` };
    else paths.cover = { ok: false, text: `Cover: you hold ${p}% of the song; other publishers must agree.` };
  } else {
    const onePub = pubCount === 1 && (named(pub.controllers)[0].share ?? 100) >= 100;
    const oneMas = masCount === 1;
    const same = onePub && oneMas && named(pub.controllers)[0].name === named(mas.controllers)[0].name;
    paths.original = same ? { ok: true, text: 'Original: one company controls song and recording.' } : { ok: false, text: 'Original: song and recording sit with different parties.' };
    const p0 = named(pub.controllers)[0];
    paths.cover = onePub ? { ok: true, publisher: p0.name, role: p0.role || 'held by', text: `Cover: needs the song only, ${p0.role || 'held by'} ${p0.name}.` } : { ok: false, text: 'Cover: song control is unclear.' };
  }

  let category;
  if (paths.original.ok) category = 'one-stop';
  else if (paths.cover.ok) category = 'cover';
  else category = 'needs-consent';
  return { category, label: CATEGORY_LABEL[category], reason: '', sources, manual: !!manual, paths };
}
