// Small pure helpers shared by the page and the tests (no DOM).

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

// A mailto: link for a drafted letter. The "Subject:" line becomes the subject; the "To:" and
// "Subject:" header lines are left out of the body. The recipient is whatever address the viewer
// typed (or empty, so the email app asks). Sleeper Hit never sends email itself.
export function mailtoFor(text, to = '') {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  let subject = '';
  let i = 0;
  while (i < lines.length && /^(To|Subject):/i.test(lines[i])) {
    const m = lines[i].match(/^Subject:\s*(.*)$/i);
    if (m) subject = m[1].trim();
    i++;
  }
  while (i < lines.length && !lines[i].trim()) i++;
  const body = lines.slice(i).join('\r\n').trimEnd();
  const addr = String(to || '').trim();
  const recipient = EMAIL.test(addr) ? addr : '';
  const q = [subject && `subject=${encodeURIComponent(subject)}`, body && `body=${encodeURIComponent(body)}`].filter(Boolean).join('&');
  return `mailto:${recipient}${q ? `?${q}` : ''}`;
}

const isPct = (s) => /^\s*\d{1,3}(\.\d+)?\s*%?\s*$/.test(s) && Number(String(s).replace('%', '')) <= 100;

// One artist per line: "Name" or "Name, song share %, recording share %[, song title]".
// Names may contain commas ("Crosby, Stills, Nash & Young"): the shares are the first two numbers.
export function parseCatalogue(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(',').map((p) => p.trim());
    let at = -1;
    for (let i = 1; i + 1 < parts.length; i++) if (isPct(parts[i]) && isPct(parts[i + 1])) { at = i; break; }
    if (at === -1) { out.push({ name: line, pub: null, mas: null, song: null }); continue; }
    const num = (s) => Number(String(s).replace('%', ''));
    out.push({ name: parts.slice(0, at).join(', '), pub: num(parts[at]), mas: num(parts[at + 1]), song: parts.slice(at + 2).join(', ') || null });
  }
  return out;
}

// Back to the text a person typed (for "Edit list").
export const catalogueText = (list) => (list || []).map((a) => [a.name, ...(a.pub !== null && a.pub !== undefined ? [a.pub, a.mas] : []), ...(a.song ? [a.song] : [])].join(', ')).join('\n');
