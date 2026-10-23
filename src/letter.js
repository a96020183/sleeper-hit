// Pitch letter drafts. Structure (fixed): 1) the song and what it is pitched for (launch trailer,
// first trailer, episodes) plus one sourced fact about how the earlier work used music, 2) one
// plain-language data reason, 3) one clearance line, signed by the person. Raw Qloo scores never appear, and the
// letter never claims the artist "will be picked": Qloo describes aggregate audiences.
// With OPENAI_API_KEY set, OpenAI writes the draft from these facts; otherwise a template does.
import { config } from './config.js';

// Only mention audience overlap at or above this. Our threshold: live values on 2026-10-22 ranged
// 0.58-0.82 for the demo doors, so 0.8 keeps the sentence for the closest matches only.
export const OVERLAP_STRONG = 0.8;

export function letterFacts({ artist, door, song, manualPct = artist.clearance?.manual?.publishingPct }) {
  const w = door.window;
  const cover = door.clearance.paths?.cover;
  const original = door.clearance.paths?.original;
  // Clearance sentence: states only what the card's sources support, never a promise.
  const originalNote = 'The original recording needs a separate OK from the label that owns it.';
  let clearanceLine;
  if (door.clearance.category === 'one-stop') {
    clearanceLine = Number(manualPct) >= 100
      ? 'We control both the song and the original recording, so one licence request covers both.'
      : 'One company controls both the song and the original recording, so one licence request covers both.';
  } else if (cover?.ok) {
    const p = Number(manualPct);
    if (cover.caveat) clearanceLine = `A cover needs a licence for the song only. We hold ${p}% of the publishing; the other ${100 - p}% is not yet confirmed. ${originalNote}`;
    else if (p >= 100) clearanceLine = `A cover needs a licence for the song only, and we control the publishing. ${originalNote}`;
    else if (cover.role === 'listed by') clearanceLine = `${cover.publisher} lists the song in its catalogue, so a cover or trailer re-record should need one licence request; we would confirm its share before quoting. ${originalNote}`;
    else clearanceLine = `${cover.publisher || 'One publisher'} ${cover.role === 'administered by' ? 'administers' : 'controls'} the song, so a cover needs one licence request. ${originalNote}`;
  } else {
    clearanceLine = 'Both a cover and the original need other rights holders\' OK, which we would confirm before quoting.';
  }
  const pitchFor = w.kind === 'game' ? `a launch trailer or TV spot for ${w.title}`
    : w.kind === 'film' ? `the first trailer for ${w.title}`
      : `${w.title}${w.season ? ` ${w.season}` : ''}`;
  return {
    artist: artist.name,
    song: song || artist.songs?.[0] || null,
    pitchFor,
    recipient: door.recipient,
    title: w.title + (w.season ? ` ${w.season}` : ''),
    earlier: w.earlier.label,
    sceneHint: w.sceneHint || '',
    topPct: door.topPct,
    affinityRank: door.blend?.affinityRank ?? null,
    poolSize: door.blend?.of ?? null,
    overlapStrong: door.overlap !== null && door.overlap >= OVERLAP_STRONG,
    clearanceLine,
  };
}

export function templateLetter(f) {
  const song = f.song ? `"${f.song}"` : '[Song]';
  const lines = [
    `To: ${f.recipient}, ${f.title}`,
    `Subject: ${f.song ? f.song : '[Song]'} by ${f.artist} for ${f.title}`,
    '',
    'Hi [Name],',
    '',
    `I'd like to put ${song} by ${f.artist} forward for ${f.pitchFor || f.title}.${f.sceneHint ? ' ' + f.sceneHint : ''}`,
    '',
    (f.affinityRank && f.affinityRank <= 100
      ? `Why ${f.artist}: in Qloo's audience data, ${f.earlier} fans rank them No. ${f.affinityRank} of about 3,000 well-known artists by affinity.`
      : `Why ${f.artist}: in Qloo's audience data, they sit in the top ${f.topPct}% of about 3,000 well-known artists for ${f.earlier} fans, weighing affinity and how widely they are known.`) +
      (f.overlapStrong ? ` Their listeners also match that audience closely by age and gender.` : ''),
    '',
    f.clearanceLine + ' We can confirm terms within [time frame].',
    '',
    'Best,',
    '[Your name]',
    '[Company]',
  ];
  return lines.join('\n');
}

const SYSTEM = `You draft short sync pitch letters for a music rights holder.
Rules:
- Plain, warm, specific. Under 150 words in the body. No hype words.
- First line after the greeting: the song and what it is pitched for (pitchFor), then the scene hint if given. Do not invent scenes, trailer contents or past uses beyond the scene hint. If no song is given, write [Song].
- Second paragraph: one short data reason exactly as given, in plain words. Never add numbers that are not given. Never say the artist will be chosen.
- Third paragraph: the clearance line as given, plus "We can confirm terms within [time frame]." Do not add any rights claim beyond the clearance line.
- Keep the "To:" and "Subject:" lines, the greeting "Hi [Name]," and sign off with "Best," then "[Your name]" and "[Company]".`;

export async function draftLetter(facts, { fetchImpl = fetch } = {}) {
  const template = templateLetter(facts);
  if (!config.openaiKey) return { text: template, engine: 'template' };
  try {
    const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.openaiKey}` },
      body: JSON.stringify({
        model: config.openaiModel,
        temperature: 0.4,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Facts (JSON):\n${JSON.stringify(facts)}\n\nA correct baseline draft you may improve:\n${template}` },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
    const body = await res.json();
    const text = body?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('empty OpenAI response');
    return { text, engine: 'openai' };
  } catch (e) {
    return { text: template, engine: 'template', error: String(e.message || e) };
  }
}
