// Songs the sealed titles actually used, added after release from public listings.
// A person adds each list (artist names + source URL + date checked); `npm run settle` then scores
// the sealed forecast against it. Empty until the first sealed title is out.
//
// Shape: 'title-id': { source: 'https://…', checkedOn: 'YYYY-MM-DD', what: 'season 2, all episodes', artists: ['…'] }
export const NEW_SOUNDTRACKS = {};

// Artists already known to be used before the seal (earlier trailers of the same title). They are
// not counted as positives. Only sourced entries.
export const KNOWN_BEFORE_SEAL = {
  'gta-vi': ['Tom Petty', 'The Pointer Sisters'], // trailers 1 and 2 (UMPG, Luminate; see src/data/windows.js)
};
