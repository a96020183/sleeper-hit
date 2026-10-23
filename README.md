# Sleeper Hit

An agent for music rights holders. It finds sequels whose audience loves a quiet artist more than popularity predicts, checks clearance, and drafts the pitch letter. A person picks the song, edits the letter and sends it.

Built for the Qloo Agentic Hackathon 2026.

## What it does

Pick an artist. The page first says whether the artist is quiet right now (English Wikipedia page views, see below). Then, for every open sync window on a sequel (a returning series, a sequel film's trailer, a game sequel), the agent:

1. **Scores** the window with Qloo. The earlier title is the signal. The artist is scored together with about 100 artists of similar Qloo popularity, and the card shows the artist's affinity percentile inside that group ("top 8%"). That is the part of the audience's taste that popularity does not explain.
2. **Adds a second signal**: the age and gender overlap between the earlier title's audience and the artist's listeners (Qloo demographics).
3. **Checks clearance** from public sources plus the user's own input: one-stop, cover clearable, needs another party's consent, or unconfirmed. Every category shows its source.
4. **Checks timing**: release date, estimated first-trailer date, or production status for series. Every date is marked "announced" or "estimated".
5. **Decides**. It ranks doors by clearance, then timing, then excess affinity, then overlap. It writes at most three letters a day and gives every skipped door a one-line reason. A person can knock anyway; that choice is logged.
6. **Drafts the letter**. The first line is the song and the scene. Audience data is the second paragraph. Raw Qloo scores never appear.

Nothing is emailed. "Copy and mark sent" puts the letter on the clipboard and records it in the outbox, where the outcome can be filled in later.

The **Trust** tab holds the sealed forecast and how it gets settled, a backtest on past sequels against an LLM-only baseline, the check that Qloo affinity is not just popularity, how "quiet" is decided (and why Qloo trending is not used), the candidate titles with sources, and the fixed rules.

## How Qloo is used

| Step | Request |
|---|---|
| Resolve names | `GET /search?query=…&types=urn:entity:artist` (or `urn:entity:tv_show`, `urn:entity:movie`, `urn:entity:videogame`). Only an exact name match, with the expected year for titles, is accepted. |
| Artist pool | `GET /v2/insights?filter.type=urn:entity:artist&filter.popularity.min=…&take=50&page=…` (results come back most popular first) |
| Peer band | the same, with `filter.popularity.min/max` around the artist's popularity |
| Score | `GET /v2/insights?filter.type=urn:entity:artist&signal.interests.entities=<earlier title>&filter.results.entities=<up to 50 artist ids>` |
| Demographics | `GET /v2/insights?filter.type=urn:demographics&signal.interests.entities=<artist>,<titles>` |
| Checked, not used | `GET /v2/trending?filter.type=urn:entity:artist&signal.interests.entities=<id>&filter.start_date=…&filter.end_date=…` (see below) |

Other public data: the [Wikimedia Pageviews API](https://wikimedia.org/api/rest_v1/) (monthly English Wikipedia views, known bots excluded) for the quiet check, and the Wikidata API to turn the Wikidata id Qloo carries into an article title.

Example, ids redacted:

    GET https://hackathon.api.qloo.com/v2/insights
      ?filter.type=urn:entity:artist
      &signal.interests.entities=<earlier title id>
      &filter.results.entities=<pool artist ids>

What we measured on the hackathon key:

- Affinity depends on the signal, not on the candidate set: the same artist scored inside two different candidate lists got an identical value. So a large pool can be scored in chunks of 50 and stay on one scale (as the Taste Atlas team also reported).
- On a pool of 3,000 artists and 12 titles, the median rank correlation between affinity and popularity was 0.16 (0.13 on the first 500), and the median agreement between two titles' rankings was 0.20. Each title's audience picks its own artists. The bar, set before the test, was 0.5.
- The pool is the first 3,000 artists Qloo returns for `filter.popularity.min=0.9`, most popular first. It is not the complete top 3,000: the paging skips some very popular artists (Drake and Metro Boomin are missing). We describe it that way everywhere.
- `/v2/trending` (Oct 23, `npm run check:trending`, 25 artists): the weekly series moves from Sep 2023 to Feb 2025, returns nothing from March to mid-October 2025, and since Oct 17 2025 every series holds one repeated value. That value keeps the early-2025 order (rank correlation 0.98 with Dec 2024), so it says nothing about the last 90 days. In the moving period it also missed a known wake-up: Tom Petty's best week came 80 days after his GTA VI trailer. We do not use trending.
- `urn:demographics` returns relative scores per age band and gender, not shares. We convert them to shares against an even baseline (our assumption) before computing overlap.

### Quiet, from Wikipedia page views

Rule, fixed before the demo artist was re-checked: in the 36 complete months before today, no month in the last 24 above 1.5 times the 36-month average (no recent wake-up), and the last 3 months at or below that average (not rising now). Months are compared as views per day. `npm run check:quiet` runs it on the demo artists and on three known wake-ups: Kate Bush after Stranger Things (May 2022, caught at 9.6x) and Tom Petty after the first GTA VI trailer (Dec 2023, caught at 1.8x). The Pointer Sisters after GTA VI trailer 2 (May 2025) were flagged for a different month; the trailer month itself reached only 1.26x, so the rule can miss smaller wake-ups.

Limits: page views measure reading attention, not listening, and lean English-speaking. Without contact details in the User-Agent, Wikimedia allows about 10 page-view requests a minute, so the app makes one request per artist and caches it. A rights holder can use its own royalty statements instead, and the card then says so.

`npm run find-sleepers` applies the selection rule: the best open door in the top 20% of the 100 nearest-popularity artists, among the pool's 500 most popular, and quiet by the rule above, best door first. On Oct 23, 279 artists passed the first two filters and 80 of the 264 with enough Wikipedia history were quiet. The Verve, the earlier demo, is not quiet: July 2025 reached 2.32x its 3-year average. The new default demo is **The Clash**: quiet (last 3 months 0.93x, busiest month 1.17x), top 1% with the GTA V audience. Artists tied with it at the top of the list include Taylor Swift and Lana Del Rey; the rule measures attention against the artist's own past, not whether the artist is a catalogue act, so we chose the catalogue act by hand.

### Backtest on past sequels

`npm run backtest` asks whether an earlier title's Qloo audience points to the artists its sequel actually licensed, compared with an LLM given both titles (`gpt-4.1-mini`, the same prompt as the sealed LLM baseline) and with plain popularity. The method was written to `seal/backtest-method.json` with its hash before anything was scored. Seven pairs (Sonic 2 to 3, Godzilla vs. Kong to The New Empire, Into to Across the Spider-Verse, F9 to Fast X, Angry Birds 1 to 2, Ice Age 4 to 5, GTA IV to V), using Tunefind lists already collected for the earlier-title baseline.

Result (Oct 23): **Qloo was not ahead.** 18 sequel artists were in the pool, across 4 pairs. In each method's top 50 of 3,000: Qloo 0, LLM 0, popularity 1. Mean AUC: Qloo beyond popularity 0.40, Qloo raw affinity 0.47, LLM 0.49, popularity 0.69. The sample is small and the lists are partial, and both sides have a known bias (Qloo's audience data is current; the LLM may remember soundtracks released before its cutoff). It is still the honest reading: on these past sequels, the earlier audience's taste did not pick the songs, and popularity did better. That fits what supervisors say about choosing by scene and budget, and it is why the letter leads with the song and the scene and uses audience data as a supporting reason.

### Sealed forecast, after judging moved to Nov 2–5

- **By Oct 30:** seal. Three SHA-256 hashes (pool list, per-title ranks, baseline predictions) go in `seal/hashes.json` and the submission text, with the settlement rules. The files stay private, optionally encrypted.
- **Judging, Nov 2–5:** almost nothing can be checked. Black Doves season 2 is the only sealed title out (Nov 5), and its first season's list suggests about one new pool artist, too few to count. We say so instead of reporting a number.
- **After release:** a person adds each released title's public song list to `src/data/new_soundtracks.js`; `npm run settle` checks the hashes and scores the forecast with the same scorer as the backtest. Pass: pooled AUC 0.65 or higher and above popularity, the LLM and similar titles; fail: 0.55 or lower, or not above popularity or the LLM. Names, ranks and band percentiles are unsealed at the first settlement.
- **Jan 31, 2027:** final settlement. Fewer than 10 new artists by then means no result.

## Data handling

Qloo's developer guide says: "Do not store Qloo response data in a public repository." This repo holds no Qloo response data, entity ids or keys:

- All responses are cached privately on the server in `.private/` (git-ignored).
- The browser only receives derived values (percentiles, overlap, categories).
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
- The first live load of an artist makes about 20 Qloo calls (throttled to 4 per second) and one Wikipedia request; later loads use the private cache.

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
- The private Qloo cache is only a speed-up. After a restart it is empty; the first request re-scores with Qloo (about 20 calls, throttled) and refills it. The default artist is warmed up at start.
- The Trust tab reads only committed, public files under `seal/` (hashes, the backtest, the premise check, the trending and quiet checks, and settlement results once they exist).

Steps:

1. Push this repo to GitHub (it contains no keys; `.env` and `.private/` are git-ignored).
2. In Render, choose New > Blueprint and select the repo. `render.yaml` defines one free web service (`npm start`, health check `/healthz`, Node 22).
3. When asked, set `QLOO_API_KEY` (and `OPENAI_API_KEY` if you have one) as secret environment variables. `QLOO_BASE_URL` is preset to the hackathon URL.
4. Open the service URL. The first visit after the service wakes can take about a minute.

Any other host that runs a long-lived Node process works the same way. Qloo calls stay on the server.

## Known limitations

- Qloo results describe aggregate audiences. A high score does not mean a supervisor will pick the artist.
- Qloo stops at the artist; a person picks the song.
- Clearance categories help set priorities. They are not legal advice. Public rights data is incomplete; when in doubt the card says "Unconfirmed" and asks a person.
- The quiet rule (1.5x, 24 and 36 months, 3 months) and the overlap threshold are our choices, shown in the Trust tab. Wikipedia page views are a proxy for attention, not plays.
- The backtest did not favour Qloo (see above). Audience affinity is a supporting reason in the letter, not a prediction that the song will be picked.
- The pool is not the complete top 3,000 (Qloo paging skips some very popular artists).
- Soundtrack lists come from public Tunefind pages and are partial for long soundtracks.
- The sealed forecast cannot be scored during judging; results come after release.

## License

MIT. See [LICENSE](LICENSE).
