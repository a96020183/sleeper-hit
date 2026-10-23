// The agent run for one artist: resolve, score, check, decide. Returns only derived values
// (percentiles, overlap, categories); raw Qloo affinity/popularity values and ids stay server-side.
import { ARTISTS } from './data/artists.js';
import { WINDOWS, RECIPIENTS } from './data/windows.js';
import { ARTIST } from './qloo/client.js';
import { blendRanks, topPercent, audienceOverlap } from './scoring.js';
import { config } from './config.js';
import { classifyClearance } from './clearance.js';
import { evaluateTiming } from './timing.js';
import path from 'node:path';
import { quietFromPageviews, quietFromRoyalty, ruleWindow, catalogueFromAlbums, withCatalogue } from './quiet.js';
import { Wiki, addMonths } from './wiki.js';
import { MusicBrainz } from './musicbrainz.js';
import { makeMockWikiFetch, makeMockMbFetch } from './qloo/mock.js';
import { decide } from './agent.js';

const publicWindow = (w) => ({
  id: w.id, title: w.title, season: w.season || '', kind: w.kind, platform: w.platform || '',
  earlier: { label: w.earlier.label }, release: w.release || null, releaseMonth: w.releaseMonth || null,
  dateStatus: w.dateStatus, production: w.production || null, note: w.note || '', sources: w.sources || [],
  sceneHint: w.sceneHint || '', animation: !!w.animation,
});

// Whole-pool affinity for one earlier title, shared by every artist (cached on the client).
// The first live run costs about 60 calls per title (3,000 artists in chunks of 50); later runs hit the cache.
async function poolAffinity(client, signalId, pool) {
  client.poolAffinity ??= new Map();
  if (!client.poolAffinity.has(signalId)) {
    const p = client.scoreArtists(signalId, pool.map((a) => a.id)).then((m) => new Map([...m].map(([id, v]) => [id, v.affinity])));
    p.catch(() => client.poolAffinity.delete(signalId));
    client.poolAffinity.set(signalId, p);
  }
  return client.poolAffinity.get(signalId);
}

async function sharedPool(client) {
  client.pool ??= client.buildPool(config.poolN);
  client.pool.catch(() => { client.pool = null; });
  return client.pool;
}

// Qloo part: slow, cached per artist and day. Contains raw values; never sent to the browser.
// Card score: the artist's rank on the affinity + popularity rank blend among the pool (see
// blendRanks in src/scoring.js). An artist outside the pool is scored and ranked with it.
export async function scoreArtist(client, artistKey, today) {
  const artist = ARTISTS[artistKey];
  if (!artist) throw new Error(`Unknown artist ${artistKey}`);
  const entity = await client.resolve({ query: artist.name, type: ARTIST });
  const pool = await sharedPool(client);
  const inPool = pool.some((a) => a.id === entity.id);
  const universe = inPool ? pool : [...pool, { id: entity.id, name: entity.name, popularity: entity.popularity }];
  const clearance = null; // set per request in decideArtist
  const warnings = [];

  const doors = [];
  const signals = [];
  for (const w of WINDOWS.filter((x) => x.card)) {
    const timing = evaluateTiming(w, today);
    let pct = null, signalId = null, blend = null;
    try {
      const sig = await client.resolve({ query: w.earlier.query, type: w.earlier.type, name: w.earlier.name || w.earlier.query, year: w.earlier.year });
      signalId = sig.id;
      signals.push(sig.id);
      let aff = await poolAffinity(client, sig.id, pool);
      if (!inPool) {
        const own = await client.scoreArtists(sig.id, [entity.id]);
        aff = new Map(aff);
        if (own.has(entity.id)) aff.set(entity.id, own.get(entity.id).affinity);
      }
      const b = blendRanks(universe, aff).get(entity.id);
      if (b) { pct = b.pct; blend = { rank: b.rank, affinityRank: b.affinityRank, popularityRank: b.popularityRank, of: b.n }; }
    } catch (e) {
      warnings.push(`${w.title}: ${e.message}`);
    }
    doors.push({ id: w.id, window: publicWindow(w), signalId, recipient: RECIPIENTS[w.kind], timing, clearance, pct, topPct: topPercent(pct), blend, overlap: null });
  }

  // Second signal: demographics of each earlier title vs the artist (one request).
  let demographicsOk = false;
  try {
    const demo = await client.demographics([entity.id, ...new Set(signals)]);
    const mine = demo.get(entity.id);
    for (const d of doors) {
      const theirs = d.signalId && demo.get(d.signalId);
      if (mine && theirs) { d.overlap = +audienceOverlap(theirs, mine).toFixed(3); demographicsOk = true; }
    }
  } catch (e) {
    warnings.push(`Demographics unavailable: ${e.message}`);
  }

  // Quiet check: Wikipedia page views plus the catalogue condition (rules in src/quiet.js).
  // Qloo trending is not used.
  let quiet = null;
  try {
    quiet = await quietCheck(wikiFor(client), { title: artist.wikipedia, qid: entity.wikidata }, today);
  } catch (e) {
    warnings.push(`Wikipedia page views unavailable: ${e.message}`);
  }
  if (quiet) {
    let cat = null;
    try {
      cat = await catalogueCheck(mbFor(client), entity.wikidata, today);
    } catch (e) {
      warnings.push(`MusicBrainz unavailable: ${e.message}`);
      cat = { old: null, latest: null, why: 'MusicBrainz unavailable' };
    }
    quiet = withCatalogue(quiet, cat);
  }
  if (!quiet) quiet = quietFromRoyalty(artist.royaltyStatements) || { quiet: null, basis: 'pending', detail: 'Add royalty statements to judge.' };

  return {
    artistKey,
    today,
    poolSize: universe.length,
    quiet: { quiet: quiet.quiet, basis: quiet.basis, detail: quiet.detail, page: quiet.page || null, ratio: quiet.ratio ?? null, peakRatio: quiet.peakRatio ?? null, peakMonth: quiet.peakMonth || null, window: quiet.window || null, noWake: quiet.noWake ?? null, notRising: quiet.notRising ?? null, pageviewsQuiet: quiet.pageviewsQuiet ?? null, catalogue: quiet.catalogue || null },
    demographicsOk,
    doors,
    warnings,
  };
}

// One Wikimedia client per Qloo client; the mock Qloo gets a mock Wikimedia so tests stay offline.
export function wikiFor(client) {
  if (!client.wiki) {
    client.wiki = client.mode === 'mock'
      ? new Wiki({ fetchImpl: makeMockWikiFetch(), cacheDir: path.join(client.cacheRoot, 'wikimedia-mock'), reqPerSec: 1000 })
      : new Wiki({ cacheDir: path.join(client.cacheRoot, 'wikimedia') });
  }
  return client.wiki;
}

// One MusicBrainz client per Qloo client; the mock Qloo gets a mock MusicBrainz.
export function mbFor(client) {
  if (!client.mb) {
    client.mb = client.mode === 'mock'
      ? new MusicBrainz({ fetchImpl: makeMockMbFetch(), cacheDir: path.join(client.cacheRoot, 'musicbrainz-mock'), gapMs: 0 })
      : new MusicBrainz({ cacheDir: path.join(client.cacheRoot, 'musicbrainz') });
  }
  return client.mb;
}

// Catalogue condition: latest studio album on MusicBrainz, found through the Wikidata id.
export async function catalogueCheck(mb, qid, today) {
  const artist = await mb.artistForWikidata(qid);
  return catalogueFromAlbums(artist ? await mb.albumGroups(artist.id) : null, today);
}

// Monthly views for the 36-month window plus the current month (the rule ignores incomplete months).
export async function pageviewsFor(wiki, title, today) {
  const { from, to } = ruleWindow(today);
  return wiki.monthly(title, from, addMonths(to, 1));
}

// The artist's quiet verdict from English Wikipedia page views (one request per artist).
export async function quietCheck(wiki, { title, qid }, today) {
  const page = title || (qid ? (await wiki.titlesFor([qid])).get(qid) : null);
  if (!page) return null;
  const own = quietFromPageviews(await pageviewsFor(wiki, page, today), today);
  return own ? { ...own, page } : null;
}

// Decision part: cheap, per request. `manual` is the viewer's own share ({ publishingPct, masterPct }),
// `overrides` the doors the viewer chose to knock anyway. Both live in the viewer's browser.
export function manualRecord(artist, manual) {
  if (!manual) return artist.clearance;
  const p = Math.max(0, Math.min(100, Number(manual.publishingPct)));
  const m = Math.max(0, Math.min(100, Number(manual.masterPct)));
  if (Number.isNaN(p) || Number.isNaN(m)) return artist.clearance;
  return { ...artist.clearance, manual: { persona: `You hold ${p}% of the song and ${m}% of the recording.`, publishingPct: p, masterPct: m } };
}

export function decideArtist(scored, { overrides = new Set(), manual = null } = {}) {
  const artist = ARTISTS[scored.artistKey];
  const record = manualRecord(artist, manual);
  const clearance = classifyClearance(record);
  const q = scored.quiet;
  const block = q && q.quiet === false ? `${artist.name} is not quiet right now, so no letters. Sleeper Hit pitches catalogue artists whose attention has gone flat.` : null;
  const decided = decide(scored.doors.map((d) => ({ ...d, clearance })), { overrides, block });
  return {
    artist: { key: artist.key, name: artist.name, songs: artist.songs, persona: record.manual?.persona || null, manualPct: record.manual?.publishingPct ?? null, clearanceNote: artist.clearanceNote || '', sources: artist.sources || [] },
    today: scored.today,
    poolSize: scored.poolSize,
    quiet: scored.quiet,
    demographicsOk: scored.demographicsOk,
    doors: decided.map(({ signalId, pct, ...d }) => ({ ...d, pctRounded: pct === null ? null : Math.round(pct) })),
    warnings: scored.warnings,
  };
}

// Card-score ranks of every pool artist for one window (no extra Qloo calls once the pool is scored).
// Returns Map normalized name -> { topPct, rank, affinityRank, popularityRank, of }.
export async function windowRanks(client, windowId) {
  const w = WINDOWS.find((x) => x.id === windowId);
  const sig = await client.resolve({ query: w.earlier.query, type: w.earlier.type, name: w.earlier.name || w.earlier.query, year: w.earlier.year });
  const pool = await sharedPool(client);
  const aff = await poolAffinity(client, sig.id, pool);
  const ranks = blendRanks(pool, aff);
  const out = new Map();
  for (const a of pool) {
    const b = ranks.get(a.id);
    if (b) out.set(normName(a.name), { topPct: topPercent(b.pct), rank: b.rank, affinityRank: b.affinityRank, popularityRank: b.popularityRank, of: b.n });
  }
  return out;
}
export const normName = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

// The same decision with the card score replaced by popularity rank alone ("without Qloo's audience signal").
export function popularityOnly(scored) {
  return {
    ...scored,
    doors: scored.doors.map((d) => (d.blend ? { ...d, pct: (100 * (d.blend.of - (d.blend.popularityRank - 1) - 0.5)) / d.blend.of } : d)),
  };
}

export async function runArtist(client, artistKey, today, opts = {}) {
  return decideArtist(await scoreArtist(client, artistKey, today), opts);
}
