// Pitch letter drafts. Structure (fixed): 1) the song and the scene, 2) two plain-language data
// reasons, 3) one clearance line, signed by the person. Raw Qloo scores never appear, and the
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
    else if (cover.role === 'listed by') clearanceLine = `${cover.publisher} lists the song in its catalogue, so a cover should need one licence request; we would confirm its share before quoting. ${originalNote}`;
    else clearanceLine = `${cover.publisher || 'One publisher'} ${cover.role === 'administered by' ? 'administers' : 'controls'} the song, so a cover needs one licence request. ${originalNote}`;
  } else {
    clearanceLine = 'Both a cover and the original need other rights holders\' OK, which we would confirm before quoting.';
  }
  return {
    artist: artist.name,
    song: song || null,
    recipient: door.recipient,
    title: w.title + (w.season ? ` ${w.season}` : ''),
    earlier: w.earlier.label,
    sceneHint: w.sceneHint || '',
    topPct: door.topPct,
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
    `${song} by ${f.artist} could sit under [scene] in ${f.title}.${f.sceneHint ? ' ' + f.sceneHint : ''}`,
    '',
    `Why ${f.artist}: of about 3,000 well-known artists, they rank in the top ${f.topPct}% for the ${f.earlier} audience, weighing how much that audience likes them and how widely they are known.` +
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
- First line after the greeting: the song and the scene it could fit. If no song is given, write [Song]. Always leave the scene as [scene] for the person to fill, optionally followed by one sentence drawn from the scene hint.
- Second paragraph: the data reasons exactly as given, in plain words. Never add numbers that are not given. Never say the artist will be chosen.
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
