// Public candidate list: sequels whose music may still be open. This file holds only public facts
// (titles, dates, sources). Qloo entity ids are resolved at run time and cached privately.
//
// dateStatus: 'announced' = date published by the platform or studio; 'estimated' = our estimate.
// First-trailer estimates use Stephen Follows' averages: 126 days before release (live action),
// 217 days (animation). Series show no countdown; production status stands in for it.

export const SOURCES = {
  looper2027: 'https://www.looper.com/1982230/2027-movie-release-schedule/',
  follows: 'https://stephenfollows.com/far-advance-film-trailers-released/',
  blackDovesVariety: 'https://au.variety.com/2026/tv/news/black-doves-season-2-trailer-netflix-keira-knightley-40678/',
  blackDovesAVClub: 'https://www.avclub.com/black-doves-season-2-trailer',
  yellowjacketsVariety: 'https://au.variety.com/2026/tv/news/yellowjackets-final-season-4-release-date-39564/',
  gtaTrailerUMPG: 'https://www.umusicpub.com/us/news/grand-theft-auto-vi-trailer-tom-petty',
  gtaTrailerLuminate: 'https://luminatedata.com/blog/music-gaming-hot-together/',
  gtaDate: 'https://gigazine.net/gsc_news/en/20251107-grand-theft-auto-vi-launch-november-19-2026',
  empressNetflix: 'https://about.netflix.com/en/news/the-empress-date-announcement-of-the-final-and-third-season',
  northCBC: 'https://www.cbc.ca/mediacentre/program/north-of-north',
  northWhatsOn: 'https://whats-on-netflix.com/news/north-of-north-season-2-netflix-release-window-cast',
};

export const RECIPIENTS = {
  series: 'Music supervisor, series',
  film: 'Trailer music team, studio marketing',
  game: 'Marketing music team (trailers and TV spots)',
};

export const WINDOWS = [
  {
    id: 'black-doves-s2', title: 'Black Doves', season: 'Season 2', kind: 'series', platform: 'Netflix',
    earlier: { query: 'Black Doves', type: 'urn:entity:tv_show', year: '2024', label: 'Black Doves season 1' },
    release: '2026-11-05', dateStatus: 'announced', production: 'post-production',
    note: 'Season 2 trailer released Sept 24; all six episodes drop at once.',
    sources: [SOURCES.blackDovesVariety, SOURCES.blackDovesAVClub],
    sceneHint: 'Season 1 used several licensed songs an episode, often under late-night London scenes.',
    card: true, sealed: true,
  },
  {
    id: 'gta-vi', title: 'Grand Theft Auto VI', season: '', kind: 'game', platform: 'Rockstar Games',
    earlier: { query: 'Grand Theft Auto V', type: 'urn:entity:videogame', year: '2014', label: 'GTA V' },
    release: '2026-11-19', dateStatus: 'announced', production: 'launch',
    note: 'Trailer 1 used Tom Petty’s “Love Is a Long Road”; trailer 2 used The Pointer Sisters’ “Hot Together”. A launch trailer usually follows.',
    sources: [SOURCES.gtaDate, SOURCES.gtaTrailerUMPG, SOURCES.gtaTrailerLuminate],
    sceneHint: 'The first two trailers were each built around one licensed song by a well-known act: Tom Petty’s “Love Is a Long Road” and The Pointer Sisters’ “Hot Together”.',
    card: true, sealed: true,
  },
  {
    id: 'sonic-4', title: 'Sonic the Hedgehog 4', season: '', kind: 'film', animation: false, platform: 'Paramount',
    earlier: { query: 'Sonic the Hedgehog 3', type: 'urn:entity:movie', year: '2024', label: 'Sonic the Hedgehog 3' },
    release: '2027-03-19', dateStatus: 'announced',
    sources: [SOURCES.looper2027, SOURCES.follows],
    sceneHint: 'A first teaser usually leans on one big, recognisable chorus.',
    card: true, sealed: true,
  },
  {
    id: 'gxk-supernova', title: 'Godzilla x Kong: Supernova', season: '', kind: 'film', animation: false, platform: 'Legendary / Warner Bros.',
    earlier: { query: 'Godzilla x Kong: The New Empire', type: 'urn:entity:movie', year: '2024', label: 'Godzilla x Kong: The New Empire' },
    release: '2027-03-26', dateStatus: 'announced',
    sources: [SOURCES.looper2027, SOURCES.follows],
    sceneHint: 'Monster-film trailers often pair scale with an unexpectedly tender song.',
    card: true, sealed: true,
  },
  {
    id: 'yellowjackets-s4', title: 'Yellowjackets', season: 'Season 4 (final)', kind: 'series', platform: 'Paramount+',
    earlier: { query: 'Yellowjackets', type: 'urn:entity:tv_show', year: '2021', label: 'Yellowjackets seasons 1–3' },
    release: '2026-11-20', dateStatus: 'announced', production: 'post-production',
    sources: [SOURCES.yellowjacketsVariety],
    sceneHint: 'The show is known for 90s needle drops.',
    card: true, sealed: true,
  },
  {
    id: 'empress-s3', title: 'The Empress', season: 'Season 3 (final)', kind: 'series', platform: 'Netflix',
    earlier: { query: 'The Empress', type: 'urn:entity:tv_show', year: '2022', label: 'The Empress seasons 1–2' },
    release: '2026-11-12', dateStatus: 'announced', production: 'post-production',
    note: 'Final season, six episodes. Earlier seasons mostly used score; few licensed songs expected.', sources: [SOURCES.empressNetflix], sealed: true,
  },
  {
    id: 'spider-verse-3', title: 'Spider-Man: Beyond the Spider-Verse', kind: 'film', animation: true,
    earlier: { query: 'Spider-Man: Across the Spider-Verse', type: 'urn:entity:movie', year: '2023', label: 'Across the Spider-Verse' },
    release: '2027-06-25', dateStatus: 'announced', sources: [SOURCES.looper2027, SOURCES.follows], sealed: true,
  },
  {
    id: 'shrek-5', title: 'Shrek 5', kind: 'film', animation: true,
    earlier: { query: 'Shrek', type: 'urn:entity:movie', year: '2001', label: 'Shrek' },
    release: '2027-06-30', dateStatus: 'announced', sources: [SOURCES.looper2027, SOURCES.follows], sealed: true,
  },
  {
    id: 'fast-x-2', title: 'Fast X: Part 2', kind: 'film', animation: false,
    earlier: { query: 'Fast X', type: 'urn:entity:movie', year: '2023', label: 'Fast X' },
    releaseMonth: '2027-04', dateStatus: 'announced', sources: [SOURCES.looper2027], sealed: true,
  },
  {
    id: 'httyd-2-live', title: 'How to Train Your Dragon 2 (live action)', kind: 'film', animation: false,
    earlier: { query: 'How to Train Your Dragon', type: 'urn:entity:movie', year: '2025', label: 'How to Train Your Dragon (2025)' },
    releaseMonth: '2027-06', dateStatus: 'announced', sources: [SOURCES.looper2027], sealed: true,
  },
  {
    id: 'ice-age-6', title: 'Ice Age: Boiling Point', kind: 'film', animation: true,
    earlier: { query: 'Ice Age: Collision Course', type: 'urn:entity:movie', year: '2016', label: 'Ice Age: Collision Course' },
    releaseMonth: '2027-02', dateStatus: 'announced', sources: [SOURCES.looper2027], sealed: true,
  },
  {
    id: 'angry-birds-3', title: 'The Angry Birds Movie 3', kind: 'film', animation: true,
    earlier: { query: 'The Angry Birds Movie 2', type: 'urn:entity:movie', year: '2019', label: 'The Angry Birds Movie 2' },
    releaseMonth: '2027-01', dateStatus: 'announced', sources: [SOURCES.looper2027], sealed: true,
  },
  {
    id: 'north-of-north-s2', title: 'North of North', season: 'Season 2', kind: 'series', platform: 'Netflix (Canada: APTN+ and CBC from Sept 8)',
    earlier: { query: 'North of North', type: 'urn:entity:tv_show', year: '2025', label: 'North of North season 1' },
    release: '2026-09-01', dateStatus: 'announced', production: 'released',
    note: 'Aired in Canada from Sept 1 (APTN+) and Sept 8 (CBC). Netflix date not announced as of Oct 22. Post-hoc check only: it can fail the forecast, not pass it.',
    sources: [SOURCES.northCBC, SOURCES.northWhatsOn], sealed: false, postHoc: true,
  },
];

// Judging was shortened by the organisers on Oct 22 (rules page): Nov 2-5, winners and live final Nov 5.
// finalSettle: last date the sealed forecast is scored; fewer than 10 positives by then = no result.
export const JUDGING = { start: '2026-11-02', end: '2026-11-05', winners: '2026-11-05', finalSettle: '2027-01-31' };
