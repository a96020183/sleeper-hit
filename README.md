# Sleeper Hit

An agent for music rights holders. It finds upcoming sequels whose audience ranks a quiet artist near the top, checks clearance, and drafts the pitch letter. A person picks the song, edits the letter and sends it.

Qloo measures the audience. Our code ranks the doors and decides. The language model drafts the letter and stands in as the baseline in the tests. A person sends.

Built for the Qloo Agentic Hackathon 2026.

**What we can show:** ranking artists by the earlier title's Qloo audience affinity plus popularity, on 26 sequels already out, put the artists each sequel went on to use higher more often than popularity alone or an LLM. The method was committed before any song list was collected, and `npm run backtest` re-runs it. Series and titles newer than the LLM did not show that advantage; see [Backtest](#backtest-on-past-sequels).

## What it does

Pick an artist. The page first says whether the artist is quiet right now (English Wikipedia page views, see below). Then, for every open sync window on a sequel (a returning series, a sequel film's trailer, a game sequel), the agent:

1. **Scores** the window with Qloo. The earlier title is the signal. Qloo ranks about 3,000 well-known artists by that audience's affinity; the card shows the artist's affinity rank and popularity rank ("Qloo says"), and our score: the two ranks averaged, as "top X%" of the pool ("Our read").
2. **Adds a second signal**: the age and gender overlap between the earlier title's audience and the artist's listeners (Qloo demographics).
3. **Checks clearance** from public sources plus the user's own input: one-stop, cover clearable, needs another party's consent, or unconfirmed. Every category shows its source.
4. **Checks timing**: release date, estimated first-trailer date, or production status for series. Every date is marked "announced" or "estimated".
5. **Decides**. It ranks doors by clearance, then timing, then the card score, then overlap. It writes at most three letters a day and gives every skipped door a one-line reason. A person can knock anyway; that choice is logged.
6. **Drafts the letter**. The first line is the song and the scene. Audience data is the second paragraph. Raw Qloo scores never appear.

Nothing is emailed. "Copy and mark sent" puts the letter on the clipboard and records it in the outbox, where the outcome can be filled in later.

The **Trust** tab holds the backtest, the sealed forecast and how it gets settled, the check that Qloo affinity is not just popularity, what we learned about Qloo's data, how much Qloo we used, how "quiet" is decided, the data sources, the candidate titles and the fixed rules.

## How Qloo is used

| Step | Request |
|---|---|
| Resolve names | `GET /search?query=…&types=urn:entity:artist` (or `urn:entity:tv_show`, `urn:entity:movie`, `urn:entity:videogame`). Only an exact name match, with the expected year for titles, is accepted. |
| Artist pool | `GET /v2/insights?filter.type=urn:entity:artist&filter.popularity.min=0.9&take=50&page=…` (results come back most popular first) |
| Score | `GET /v2/insights?filter.type=urn:entity:artist&signal.interests.entities=<earlier title>&filter.results.entities=<up to 50 artist ids>`, repeated over the whole pool |
| Demographics | `GET /v2/insights?filter.type=urn:demographics&signal.interests.entities=<artist>,<titles>` |
| Checked, not used | `GET /v2/trending?filter.type=urn:entity:artist&signal.interests.entities=<id>&filter.start_date=…&filter.end_date=…` (see below) |

Other public data: the [Wikimedia Pageviews API](https://wikimedia.org/api/rest_v1/) (monthly English Wikipedia views, known bots excluded) for the quiet check, and the Wikidata API to turn the Wikidata id Qloo carries into an article title.

Example, ids redacted:

    GET https://hackathon.api.qloo.com/v2/insights
      ?filter.type=urn:entity:artist
      &signal.interests.entities=<earlier title id>
      &filter.results.entities=<pool artist ids>

### The card score

With the earlier title as the signal, rank the pool by Qloo affinity and by Qloo popularity, average the two ranks, break ties by affinity (`blendRanks` in `src/scoring.js`). The card shows it as "top X%" of the pool; doors below the top 50% are not knocked.

**We changed this score after seeing the backtest.** Until Oct 23 the card and the seal used excess affinity: the artist's affinity percentile among artists of similar popularity. It did not clear the registered bar (pooled AUC 0.71 [0.64, 0.79]; +0.03 [-0.05, +0.14] over popularity; +5 [-10, +20] top-50 hits over the LLM). Of the four Qloo uses registered before the backtest, only the rank blend cleared it, so the card and the seal now use the blend. Picking the winner after the fact favours it; the sealed forecast, settled after release, is the test it has not seen. The original score stays in the seal (`excessRank`) and will be reported next to the blend, but does not decide the verdict.

### How much Qloo we used

About 6,400 live Qloo calls while building and testing (our own call log), on three endpoints: `/search`, `/v2/insights` (`urn:entity:artist` and `urn:demographics`) and `/v2/trending` (checked, then dropped). Search ran across four entity types. One request was rejected (a trending query over a full year). After a restart the app re-scores the pool once, about 370 calls throttled to 4 a second, then serves from its private cache; each further artist costs about two calls.

### What we learned about Qloo's data

- Affinity depends on the signal, not on the other artists in the request: the same artist scored inside two different candidate lists got an identical value. So a large pool can be scored in chunks of 50 and stay on one scale (as the Taste Atlas team also reported).
- Affinity is not popularity in disguise. On 3,000 artists and 12 titles, the median rank correlation between affinity and popularity was 0.16 (0.13 on the first 500), and the median agreement between two titles' rankings was 0.20. Each title's audience picks its own artists. The bar, set before the test, was 0.5.
- The pool is the first 3,000 artists Qloo returns for `filter.popularity.min=0.9`, most popular first. It is not the complete top 3,000: the paging skips some very popular artists (Drake and Metro Boomin are missing). We describe it that way everywhere.
- A returning series is one Qloo entity across seasons, so its audience already includes the new season. Series are reported apart in the backtest for that reason.
- `/v2/trending` (Oct 23, `npm run check:trending`, 25 artists): the weekly series moves from Sep 2023 to Feb 2025, returns nothing from March to mid-October 2025, and since Oct 17 2025 every series holds one repeated value. That value keeps the early-2025 order (rank correlation 0.98 with Dec 2024), so it says nothing about the last 90 days. In the moving period it also missed a known wake-up: Tom Petty's best week came 80 days after his GTA VI trailer. We do not use trending.
- `urn:demographics` returns relative scores per age band and gender, not shares. We convert them to shares against an even baseline (our assumption) before computing overlap.

### Quiet, from Wikipedia page views

Rule, fixed before the demo artist was re-checked: in the 36 complete months before today, no month in the last 24 above 1.5 times the 36-month average (no recent wake-up), and the last 3 months at or below that average (not rising now). Months are compared as views per day. `npm run check:quiet` runs it on the demo artists and on three known wake-ups: Kate Bush after Stranger Things (May 2022, caught at 9.6x) and Tom Petty after the first GTA VI trailer (Dec 2023, caught at 1.8x). The Pointer Sisters after GTA VI trailer 2 (May 2025) were flagged for a different month; the trailer month itself reached only 1.26x, so the rule can miss smaller wake-ups.

Limits: page views measure reading attention, not listening, and lean English-speaking. Without contact details in the User-Agent, Wikimedia allows about 10 page-view requests a minute, so the app makes one request per artist and caches it. A rights holder can use its own royalty statements instead, and the card then says so.

`npm run find-sleepers` applies the selection rule: the best open door in the top 20% of the pool on the card score, among the pool's 500 most popular, and quiet by the rule above, best door first. On Oct 23, with the card score changed to the rank blend, 491 of the 500 passed the door filter (the blend favours well-known artists, so the quiet rule does most of the narrowing), and 140 of the 463 with enough Wikipedia history were quiet. The Verve, the earlier demo, is not quiet: July 2025 reached 2.32x its 3-year average.

The default demo is **The Clash**: quiet (last 3 months 0.93x, busiest month 1.17x), and the GTA V audience's top artist by affinity among 2,992 scored (No. 109 by popularity; No. 28 on the blend, top 1%). It is 25th on the quiet list. Ahead of it are current stars such as Taylor Swift and Lana Del Rey and other catalogue acts such as The Beatles and Pink Floyd. The rule measures attention against the artist's own past, not whether the artist is a catalogue act, so the demo artist is our choice, not the rule's. Under the earlier score, The Clash was tied first.

## Backtest on past sequels

`npm run backtest` asks whether an earlier title's Qloo audience ranks the artists its sequel newly used (artists not on the earlier title's list) above the rest of the 3,000-artist pool, compared with Qloo popularity, an LLM given both titles (`gpt-4.1-mini`, the sealed baseline's prompt), and "what similar titles used". The whole method, including the candidate list, the inclusion rules, four Qloo uses, popularity thirds and an after-LLM-cutoff split, was committed in `seal/backtest-v2-method.json` (commit `034f21e`) before any list was collected or any number computed; the script refuses to run if that file changes.

36 candidates; 26 pairs scored (20 films and games, 6 series), 249 positives, 18 franchises. 10 were left out (no song list, no new pool artists, or the Qloo call budget).

**Where Qloo helps most:**

- **Less famous artists.** In the middle and least popular thirds of the pool, the card score beats popularity by +0.24 and +0.21 AUC (lower ends +0.13 and +0.10). These are the catalogue artists a rights holder most needs help with.
- **The LLM sticks to stars.** All 23 of the LLM's top-50 hits were in the most popular third; it found none in the other two. The card score found 23 there.
- **The audience signal is steady.** A second registered check (`seal/sibling-check-method.json`, commit `8893210`) compared close sibling titles (19 pairs, for example consecutive Twilight films, GTA V and Red Dead Redemption 2, Bridgerton and The Gilded Age) with 923 unrelated pairs. Qloo's artist lists overlapped 4.4x more for siblings (raw affinity; 4.6x for excess affinity; p < 0.001; bar 3x and p < 0.01), with only a weak link to release-year distance. The LLM reached 1.8x, because it names the same famous artists for most titles.

Result (Oct 23), pooled AUC (0.5 = chance) with 95% intervals from resampling franchises:

| Method | AUC | Hits in top 50 |
|---|---|---|
| Popularity | 0.69 [0.62, 0.73] | 12 |
| LLM only | 0.54 [0.52, 0.55] | 23 |
| What similar titles used | 0.56 [0.53, 0.60] | 15 |
| Qloo raw affinity | 0.76 [0.68, 0.83] | 37 |
| Qloo excess affinity (card score until Oct 23) | 0.71 [0.64, 0.79] | 28 |
| Qloo affinity x popularity | 0.76 [0.68, 0.83] | 37 |
| **Qloo affinity and popularity rank blend (card score)** | **0.77 [0.70, 0.82]** | **33** |

The registered bar: a Qloo use beats popularity on AUC and the LLM on top-50 hits, both with the interval's lower end above zero. The rank blend clears it: AUC +0.08 [+0.04, +0.14] over popularity, +10 [+3, +19] hits over the LLM.

**Limits:**

- Titles released after the LLM's training cutoff (9 pairs, 84 positives) and the 6 series did not show Qloo ahead of popularity. Most sealed titles are one or the other.
- In the least popular third, an LLM given only those 1,000 names found as many sequel artists as Qloo (12 vs 12).
- Four Qloo uses were tested and the intervals are not corrected for that, so this is a narrow pass. The card score was chosen after the test (see [The card score](#the-card-score)).
- Known biases, written down first: Qloo's audience data is current (favours Qloo, strongly for series, whose signal includes the new season); the LLM may remember soundtracks released before its cutoff; a shortlist of 50 caps the LLM's AUC near 0.5, which is why top-50 hits is the LLM comparison.

## Sealed forecast, after judging moved to Nov 2–5

- **By Oct 30:** seal. Three SHA-256 hashes (pool list, per-title ranks, baseline predictions) go in `seal/hashes.json` and the submission text, with the settlement rules. The sealed ranking is the card score, the affinity and popularity rank blend; `seal/hashes.json` states that this score was chosen after the backtest, why, and what the original score scored. The files stay private, optionally encrypted.
- **Judging, Nov 2–5:** almost nothing can be checked. Black Doves season 2 is the only sealed title out (Nov 5), and its first season's list suggests about one new pool artist, too few to count. We say so instead of reporting a number.
- **After release:** a person adds each released title's public song list to `src/data/new_soundtracks.js`; `npm run settle` checks the hashes and scores the forecast with the same scorer as the backtest. Pass: pooled AUC 0.65 or higher and above popularity, the LLM and similar titles; fail: 0.55 or lower, or not above popularity or the LLM. The original excess-affinity ranking is scored and reported next to it. Names and ranks are unsealed at the first settlement.
- **Jan 31, 2027:** final settlement. Fewer than 10 new artists by then means no result.

## Data sources

- **[Netflix Tudum](https://www.netflix.com/tudum):** song lists for the 6 series in the backtest and for Black Doves season 1 in the seal (12 articles), each read once, 3 seconds apart. netflix.com/robots.txt allows our crawler. Only artist names are kept; some lists are highlights, not every song.
- **[MusicBrainz](https://musicbrainz.org/doc/MusicBrainz_API):** soundtrack albums for the 20 films and games in the backtest, and the earlier titles' lists for the seal (`npm run collect-lists`). Official `/ws/2` web service, about 300 targeted lookups, one request every 1.1 seconds with a descriptive User-Agent, as the API documentation asks. Core data is CC0. Soundtrack albums can differ from what is used on screen.
- **[Wikimedia Pageviews](https://wikimedia.org/api/rest_v1/) and Wikidata:** monthly English Wikipedia views for the quiet check, one request per artist, cached.
- **Not used:** Tunefind (its robots.txt blocks our crawler) and the iTunes Search API (robots.txt disallows `/search`).

## Data handling

Qloo's developer guide says: "Do not store Qloo response data in a public repository." This repo holds no Qloo response data, entity ids or keys:

- All responses are cached privately on the server in `.private/` (git-ignored).
- The browser only receives derived values (ranks, percentiles, overlap, categories).
- The sealed forecast publishes only SHA-256 hashes. The files stay private, optionally encrypted.
- Files under `seal/` hold only hashes, counts, scores we computed and artist names.
- `npm run check:public` scans the repo for entity ids, raw values and keys before publishing.

## Setup

Requires Node.js 22 or newer. No dependencies to install.

```sh
git clone <this repo>
cd sleeper-hit
cp .env.example .env      # then put your Qloo hackathon key in QLOO_API_KEY
npm test
npm start                 # http://localhost:3000
```

- Without `QLOO_API_KEY` (or with `QLOO_MODE=mock`) the app runs on an offline mock and shows a "Qloo MOCK data" badge. Mock numbers mean nothing.
- Without `OPENAI_API_KEY`, letters come from a plain template and the app says so.
- The first live start scores the pool for every open door, about 370 Qloo calls throttled to 4 per second (roughly a minute and a half), plus one Wikipedia request per artist; later loads use the private cache.

Other commands:

```sh
npm run premise                  # key-day checks: is affinity more than popularity? is the sample big enough?
npm run find-sleepers            # scan the pool for famous artists that are quiet now (Qloo + Wikipedia)
npm run check:trending           # what /v2/trending returns for the demo artists and their peers
npm run check:quiet              # the Wikipedia quiet rule on the demo artists and three known wake-ups
npm run backtest                 # past sequels: Qloo vs an LLM vs popularity (method hashed first)
npm run seal                     # dry-run seal into .private/
SEAL_PASSWORD=… npm run seal -- --final   # final seal; writes seal/hashes.json (hashes only)
SEAL_PASSWORD=… npm run settle            # score the seal against released titles' song lists
npm run check:public             # scan for anything that must not be public
```

## Deploy on Render (free plan)

The free plan has a temporary disk and sleeps when idle. The app is built for that:

- The server keeps no user data. The outbox, "knock anyway" choices and your own rights share are saved in your browser (localStorage) and sent with each request.
- The private Qloo cache is only a speed-up. After a restart it is empty; the first request re-scores the pool with Qloo (about 370 calls, throttled) and refills it. The default artist is warmed up at start.
- The Trust tab reads only committed, public files under `seal/` (hashes, the backtest, the premise check, the trending and quiet checks, and settlement results once they exist).

Steps:

1. Push this repo to GitHub (it contains no keys; `.env` and `.private/` are git-ignored).
2. In Render, choose New > Blueprint and select the repo. `render.yaml` defines one free web service (`npm start`, health check `/healthz`, Node 22).
3. When asked, set `QLOO_API_KEY` (and `OPENAI_API_KEY` if you have one) as secret environment variables. `QLOO_BASE_URL` is preset to the hackathon URL.
4. Open the service URL. The first visit after the service wakes can take a minute or two.

Any other host that runs a long-lived Node process works the same way. Qloo calls stay on the server.

## Known limitations

- Qloo results describe aggregate audiences. A high score does not mean a supervisor will pick the artist.
- Qloo stops at the artist; a person picks the song.
- Clearance categories help set priorities. They are not legal advice. Public rights data is incomplete; when in doubt the card says "Unconfirmed" and asks a person.
- The quiet rule (1.5x, 24 and 36 months, 3 months) and the overlap threshold are our choices, shown in the Trust tab. Wikipedia page views are a proxy for attention, not plays.
- The card score was chosen after the backtest, and its pass was narrow. The backtest showed no advantage for series or for titles newer than the LLM. Audience rank is a reason to knock, not a prediction that the song will be picked.
- The pool is not the complete top 3,000 (Qloo paging skips some very popular artists).
- Song lists come from MusicBrainz soundtrack releases and Netflix Tudum articles. Albums can differ from what is used on screen; some Tudum lists are highlights.
- The sealed forecast cannot be scored during judging; results come after release.

## License

MIT. See [LICENSE](LICENSE).
