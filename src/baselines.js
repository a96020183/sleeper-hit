// Baselines for the sealed forecast. If Qloo cannot beat them, the idea fails.
//   similarTitlesBaseline: "what this title and similar titles already used" (the SyncPlacement-style
//                          answer), from official or open soundtrack lists (src/data/prior_soundtracks.js).
//   llmBaseline:           an LLM picks, from artist names alone, the 50 most likely artists.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { PRIOR_SOUNDTRACKS } from './data/prior_soundtracks.js';
import { WINDOWS } from './data/windows.js';

export const normName = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/^the /, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Score = 2 if the earlier title used the artist, +1 for every other title of the same kind
// (series, film, game) that used them. Ties keep the pool's popularity order.
export function similarTitlesBaseline(pool, titleIds, soundtracks = PRIOR_SOUNDTRACKS, windows = WINDOWS) {
  const kindOf = Object.fromEntries(windows.map((w) => [w.id, w.kind]));
  const sets = Object.fromEntries(Object.entries(soundtracks).map(([id, s]) => [id, new Set(s.artists.map(normName))]));
  const byTitle = {};
  for (const t of titleIds) {
    const scored = pool.map((a, i) => {
      const n = normName(a.name);
      let score = sets[t]?.has(n) ? 2 : 0;
      for (const [other, set] of Object.entries(sets)) if (other !== t && kindOf[other] === kindOf[t] && set.has(n)) score += 1;
      return { name: a.name, score, i };
    });
    scored.sort((x, y) => y.score - x.score || x.i - y.i);
    byTitle[t] = scored.filter((x) => x.score > 0).map((x) => x.name);
  }
  return { status: 'ready', rule: 'earlier title used the artist (2) + each same-kind candidate title that used them (1); rest unranked', source: 'Netflix Tudum and MusicBrainz lists (src/data/prior_lists.json)', byTitle };
}

// Expected positives (fixed before the test): artists in the earlier title x pool coverage x (1 - repeat rate).
export function expectedPositives(pool, soundtracks = PRIOR_SOUNDTRACKS, repeatRate = 0) {
  const poolSet = new Set(pool.map((a) => normName(a.name)));
  const rows = {};
  for (const [id, s] of Object.entries(soundtracks)) {
    const names = [...new Set(s.artists.map(normName))];
    const inPool = names.filter((n) => poolSet.has(n)).length;
    const coverage = names.length ? inPool / names.length : 0;
    rows[id] = { artists: names.length, inPool, coverage, expected: names.length * coverage * (1 - repeatRate), partial: s.partial };
  }
  return rows;
}

// Same prompt for the sealed forecast and the backtest. Responses are cached privately by request,
// so a rerun costs nothing and returns the same picks. usage counts tokens actually billed.
export async function llmBaseline(poolNames, titles, { fetchImpl = fetch, cacheDir = path.join(config.privateDir, 'cache', 'openai') } = {}) {
  if (!config.openaiKey) return { status: 'pending', reason: 'OPENAI_API_KEY not set', byTitle: {} };
  const byTitle = {};
  const usage = { calls: 0, cached: 0, inputTokens: 0, outputTokens: 0 };
  for (const t of titles) {
    const request = {
      model: config.openaiModel,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You predict music licensing. Answer with JSON {"artists": [..]} using names copied exactly from the list.' },
        { role: 'user', content: `Upcoming: ${t.title} (follows ${t.earlier}). From this list, pick the 50 artists most likely to have a song licensed in it or its trailers, most likely first.\n\n${poolNames.join('\n')}` },
      ],
    };
    const file = path.join(cacheDir, crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex') + '.json');
    let body;
    if (fs.existsSync(file)) { body = JSON.parse(fs.readFileSync(file, 'utf8')); usage.cached++; }
    else {
      const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openaiKey}` },
        body: JSON.stringify(request),
      });
      if (!res.ok) return { status: 'error', reason: `OpenAI HTTP ${res.status}`, byTitle, usage };
      body = await res.json();
      usage.calls++;
      usage.inputTokens += body.usage?.prompt_tokens || 0;
      usage.outputTokens += body.usage?.completion_tokens || 0;
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(body));
    }
    let picks = [];
    try { picks = JSON.parse(body.choices[0].message.content).artists || []; } catch { picks = []; }
    const allowed = new Set(poolNames);
    byTitle[t.id] = picks.filter((n) => allowed.has(n)).slice(0, 50);
  }
  return { status: 'ready', model: config.openaiModel, byTitle, usage };
}
