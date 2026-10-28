// MOCK Qloo: an offline stand-in used only when there is no key or QLOO_MODE=mock.
// It answers /search, /v2/insights (artist scoring, popularity paging, urn:demographics) and
// /v2/trending in the same response shape the live hackathon API returned on 2026-10-22.
// Every number it produces is synthetic. The UI shows a MOCK badge whenever it is in use.
import crypto from 'node:crypto';

const FEATURES = ['e60', 'e70', 'e80', 'e90', 'e00', 'e10', 'e20', 'soft_rock', 'new_wave', 'rock', 'hiphop', 'pop', 'indie', 'alt', 'electronic', 'rnb', 'country'];
const AGES = ['24_and_younger', '25_to_29', '30_to_34', '35_to_44', '45_to_54', '55_and_older'];

const h = (...parts) => parseInt(crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 12), 16) / 16 ** 12;
const mockId = (name) => {
  const x = crypto.createHash('sha256').update('sleeperhit-mock:' + name.toLowerCase()).digest('hex').toUpperCase();
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
};
const mockQid = (name) => 'q9' + String(parseInt(crypto.createHash('sha256').update('qid:' + name).digest('hex').slice(0, 8), 16));
const vec = (o) => FEATURES.map((f) => o[f] || 0);

// Hand-written taste vectors for the demo artists and earlier titles. Not Qloo data.
const NAMED_ARTISTS = {
  'Air Supply': [{ e80: 1, e70: 0.6, soft_rock: 1, pop: 0.5 }, 0.9911],
  'Culture Club': [{ e80: 1, new_wave: 1, pop: 0.7, rnb: 0.3 }, 0.9917],
  'The Clash': [{ e70: 0.8, e80: 0.7, rock: 1, new_wave: 0.4 }, 0.9993],
  'The Verve': [{ e90: 1, alt: 0.8, rock: 0.6, indie: 0.5 }, 0.9992],
  'Iggy Pop': [{ e70: 1, rock: 1, alt: 0.5 }, 0.9989],
};
const TITLES = {
  'Grand Theft Auto V': ['urn:entity:videogame', { e80: 0.8, e70: 0.5, e90: 0.4, hiphop: 0.7, rock: 0.6, soft_rock: 0.5, pop: 0.5, new_wave: 0.4 }, 0.958, '2014-11-18, Rockstar North'],
  'Black Doves': ['urn:entity:tv_show', { e10: 0.6, e20: 0.7, e80: 0.3, indie: 0.8, alt: 0.5, electronic: 0.4, new_wave: 0.3 }, 0.485, '2024'],
  'The Empress': ['urn:entity:tv_show', { e20: 0.6, pop: 0.5, electronic: 0.5 }, 0.6, '2022'],
  'Sonic the Hedgehog 3': ['urn:entity:movie', { e20: 0.8, e10: 0.6, pop: 0.8, hiphop: 0.6, electronic: 0.5, e80: 0.2 }, 0.995, '2024'],
  'Godzilla x Kong: The New Empire': ['urn:entity:movie', { e80: 0.6, e70: 0.5, rock: 0.8, pop: 0.4, soft_rock: 0.4, new_wave: 0.3 }, 0.985, '2024'],
  'Spider-Man: Across the Spider-Verse': ['urn:entity:movie', { e20: 0.8, hiphop: 0.9, electronic: 0.5, rnb: 0.5 }, 0.998, '2023'],
  Shrek: ['urn:entity:movie', { e00: 0.8, e90: 0.5, pop: 0.7, rock: 0.5, alt: 0.4 }, 0.999, '2001'],
  'Fast X': ['urn:entity:movie', { e20: 0.7, hiphop: 0.9, rnb: 0.5, electronic: 0.4 }, 0.99, '2023'],
  'How to Train Your Dragon': ['urn:entity:movie', { e20: 0.6, pop: 0.5, indie: 0.4 }, 0.99, '2025'],
  'Ice Age: Collision Course': ['urn:entity:movie', { e10: 0.6, pop: 0.8 }, 0.95, '2016'],
  'The Angry Birds Movie 2': ['urn:entity:movie', { e10: 0.7, pop: 0.8, hiphop: 0.3 }, 0.95, '2019'],
  Yellowjackets: ['urn:entity:tv_show', { e90: 1, alt: 0.9, rock: 0.6, pop: 0.3, indie: 0.3 }, 0.967, '2021'],
  'North of North': ['urn:entity:tv_show', { e20: 0.6, indie: 0.6, country: 0.4 }, 0.4, '2025'],
};

function cosine(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

export class MockWorld {
  constructor(size = 3200) {
    this.byId = new Map();
    for (let i = 1; i <= size; i++) {
      const name = `Mock Artist ${String(i).padStart(4, '0')}`;
      const v = {};
      v[FEATURES[Math.floor(h(name, 'era') * 7)]] = 1;
      v[FEATURES[7 + Math.floor(h(name, 's1') * 10)]] = 1;
      v[FEATURES[7 + Math.floor(h(name, 's2') * 10)]] = 0.5;
      // Popularity falls off with index, shaped like the live API (top ~1.0, rank 3000 ~0.990).
      const pop = 1 - 0.0000033 * i * (0.9 + 0.2 * h(name, 'p'));
      this.add(name, 'urn:entity:artist', vec(v), pop, name);
    }
    for (const [name, [v, pop]] of Object.entries(NAMED_ARTISTS)) this.add(name, 'urn:entity:artist', vec(v), pop, name);
    for (const [name, [type, v, pop, dis]] of Object.entries(TITLES)) this.add(name, type, vec(v), pop, dis);
  }

  add(name, subtype, v, popularity, disambiguation) {
    const e = { entity_id: mockId(name), name, subtype, v, popularity, disambiguation };
    this.byId.set(e.entity_id, e);
    return e;
  }

  artistsByPopularity() {
    return [...this.byId.values()].filter((e) => e.subtype === 'urn:entity:artist').sort((a, b) => b.popularity - a.popularity);
  }

  affinity(signal, artist) {
    const v = 0.55 + 0.3 * cosine(signal.v, artist.v) + 8 * (artist.popularity - 0.995) + (h(signal.entity_id, artist.entity_id) - 0.5) * 0.08;
    return Math.min(0.99, Math.max(0.05, v));
  }

  demographics(e) {
    const [e60, e70, e80, e90, e00, e10, e20] = e.v;
    const old = e60 + e70 + e80 * 0.8, young = e10 + e20 + e00 * 0.5;
    const tilt = (old - young) / (old + young + e90 + 1);
    const age = {};
    AGES.forEach((a, i) => { age[a] = +(tilt * (i - 2.5) / 2.5 * 0.6 + (h(e.entity_id, a) - 0.5) * 0.1).toFixed(4); });
    const male = +((e.v[FEATURES.indexOf('rock')] + e.v[FEATURES.indexOf('hiphop')] - e.v[FEATURES.indexOf('pop')]) * 0.2).toFixed(4);
    return { age, gender: { male, female: -male } };
  }

  out(e, extra) {
    return {
      name: e.name,
      entity_id: e.entity_id,
      type: 'urn:entity',
      subtype: e.subtype,
      properties: { short_description: 'MOCK entity generated offline (not Qloo data).' },
      popularity: e.popularity,
      tags: [],
      disambiguation: e.disambiguation,
      ...(e.subtype === 'urn:entity:artist' ? { external: { wikidata: [{ id: mockQid(e.name) }] } } : {}),
      ...extra,
    };
  }
}

function json(status, body) {
  return {
    status,
    headers: new Map([['x-month-ratelimit-remaining', '49999'], ['x-sleeperhit-mock', 'true']]),
    json: async () => body,
  };
}

export function makeMockFetch(world = new MockWorld()) {
  const wrap = (r) => ({ ...r, headers: { get: (k) => r.headers.get(k.toLowerCase()) ?? null } });
  return async (url) => {
    const u = new URL(url);
    const q = Object.fromEntries(u.searchParams);
    const take = Math.min(50, Number(q.take || 20));
    const page = Math.max(1, Number(q.page || 1));
    if (u.pathname === '/search') {
      const query = (q.query || '').toLowerCase();
      const types = (q.types || '').split(',');
      const hits = [...world.byId.values()]
        .filter((e) => (!q.types || types.includes(e.subtype)) && e.name.toLowerCase().includes(query))
        .sort((a, b) => (a.name.toLowerCase() === query ? -1 : 0) - (b.name.toLowerCase() === query ? -1 : 0));
      return wrap(json(200, { success: true, duration: 1, results: hits.slice(0, take).map((e) => world.out(e)) }));
    }
    if (u.pathname === '/v2/insights' && q['filter.type'] === 'urn:demographics') {
      const ids = (q['signal.interests.entities'] || '').split(',').filter(Boolean);
      const demographics = ids.map((id) => world.byId.get(id)).filter(Boolean).map((e) => ({ entity_id: e.entity_id, query: world.demographics(e) }));
      return wrap(json(200, { success: true, results: { demographics } }));
    }
    if (u.pathname === '/v2/insights' && q['filter.type'] === 'urn:entity:artist') {
      const sig = world.byId.get((q['signal.interests.entities'] || '').split(',')[0]);
      const wanted = (q['filter.results.entities'] || '').split(',').filter(Boolean);
      let list = wanted.length ? wanted.map((id) => world.byId.get(id)).filter(Boolean) : world.artistsByPopularity();
      if (q['filter.popularity.min']) list = list.filter((e) => e.popularity >= Number(q['filter.popularity.min']));
      if (q['filter.popularity.max']) list = list.filter((e) => e.popularity <= Number(q['filter.popularity.max']));
      if (sig) list = list.filter((e) => e.entity_id !== sig.entity_id);
      if (!sig && !wanted.length && !q['filter.popularity.min']) return wrap(json(400, { message: 'at least one valid signal or filter is required' }));
      let scored = list.map((e) => [e, sig ? world.affinity(sig, e) : null]);
      if (sig) scored.sort((a, b) => b[1] - a[1]);
      scored = scored.slice((page - 1) * take, page * take);
      const entities = scored.map(([e, a]) => world.out(e, a === null ? {} : { query: { affinity: a, measurements: { audience_growth: 0 } } }));
      return wrap(json(200, { success: true, results: { entities } }));
    }
    if (u.pathname === '/v2/trending') {
      const e = world.byId.get((q['signal.interests.entities'] || '').split(',')[0]);
      if (!e) return wrap(json(400, { message: 'signal.interests.entities is required' }));
      // Live API (2026-10-22) returned a flat series: one value repeated. The mock does the same.
      const quiet = e.v[0] + e.v[1] + e.v[2];
      const rank = Math.round(2000 + 80000 * Math.min(1, quiet * 0.5 + h(e.entity_id, 't') * 0.5));
      const trending = Array.from({ length: Math.min(take, 30) }, (_, i) => ({
        date: new Date(Date.UTC(2026, 9, 20 - 7 * i)).toISOString().slice(0, 10),
        population_percentile: 0.1 + 0.01 * (1 - rank / 82000),
        population_rank: String(rank),
        population_rank_velocity: 0,
        velocity_fold_change: 0,
        population_percent_delta: 0,
      }));
      return wrap(json(200, { success: true, results: { trending } }));
    }
    return wrap(json(404, { message: `${u.pathname} is not available in the mock` }));
  };
}

// MOCK MusicBrainz: the Wikidata -> artist lookup and the album browse, with deterministic dates
// (about half the mock artists released a studio album in the last 5 years). Offline only.
export function makeMockMbFetch() {
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  return async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/url')) {
      const qid = (u.searchParams.get('resource') || '').split('/').pop();
      return ok({ relations: [{ type: 'wikidata', 'target-type': 'artist', artist: { id: `mock-${qid}`, name: `Mock ${qid}` } }] });
    }
    const artist = u.searchParams.get('artist') || '';
    const last = 1975 + Math.floor(h(artist, 'last') * 52);
    const groups = [
      { title: 'Mock debut', 'first-release-date': `${last - 10}-03-01`, 'primary-type': 'Album', 'secondary-types': [] },
      { title: 'Mock latest', 'first-release-date': `${last}-06-01`, 'primary-type': 'Album', 'secondary-types': [] },
      { title: 'Mock hits', 'first-release-date': '2025-01-01', 'primary-type': 'Album', 'secondary-types': ['Compilation'] },
    ];
    return ok({ 'release-group-count': groups.length, 'release-groups': groups });
  };
}

// MOCK Wikimedia: answers the Wikidata title lookup and the monthly page-view endpoint with a
// synthetic, deterministic series. Used only with the Qloo mock, so tests never touch the network.
export function makeMockWikiFetch() {
  const ok = (body) => ({ status: 200, json: async () => body });
  return async (url) => {
    const u = new URL(url);
    if (u.hostname === 'www.wikidata.org') {
      const ids = (u.searchParams.get('ids') || '').split('|').filter(Boolean);
      return ok({ entities: Object.fromEntries(ids.map((id) => [id, { id, sitelinks: { enwiki: { title: 'Mock page ' + id } } }])) });
    }
    const m = u.pathname.match(/user\/([^/]+)\/monthly\/(\d{6})0100\/(\d{6})0100$/);
    if (!m) return { status: 404, json: async () => ({}) };
    const title = decodeURIComponent(m[1]);
    const items = [];
    let y = Number(m[2].slice(0, 4)), mo = Number(m[2].slice(4));
    const endKey = Number(m[3]);
    const base = 2000 + 40000 * h(title, 'base');
    for (let i = 0; y * 100 + mo < endKey; i++) {
      items.push({ ts: `${y}${String(mo).padStart(2, '0')}0100`, v: Math.round(base * (1 - 0.004 * i) * (0.92 + 0.16 * h(title, String(i)))) });
      mo++; if (mo > 12) { mo = 1; y++; }
    }
    // About 4 in 10 mock artists get one 2.5x month somewhere in the last two years.
    const spikeAt = h(title, 'spike') < 0.4 ? Math.floor(h(title, 'when') * 20) : -1;
    if (spikeAt >= 0 && items.length > spikeAt + 3) items[items.length - 4 - spikeAt].v *= 2.5;
    return ok({ items: items.map((it) => ({ project: 'en.wikipedia', article: title, granularity: 'monthly', timestamp: it.ts, access: 'all-access', agent: 'user', views: it.v })) });
  };
}
