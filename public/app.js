// Sleeper Hit front end. Plain modules, no build step.
import { mailtoFor, parseCatalogue, catalogueText } from './lib.js';
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const params = new URLSearchParams(location.search);
const API_BASE = location.protocol === 'file:' ? 'http://localhost:3000' : '';

const ui = {
  artist: params.get('artist') || localGet('artist') || '',
  tab: params.get('tab') || 'today',
  data: null,
  trust: null,
  selected: null,
  edits: {},
  songs: {},
};

function localGet(k) { try { return localStorage.getItem('sh.' + k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem('sh.' + k, v); } catch { /* private mode */ } }

async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers: opts.body ? { 'Content-Type': 'application/json', ...(opts.headers || {}) } : opts.headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 2600);
}

const fmtDate = (iso) => {
  if (!iso) return '';
  if (iso.length === 7) return new Date(iso + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};
const titleOf = (w) => w.title + (w.season ? ` ${w.season}` : '');
const kindLabel = { series: 'Returning series', film: 'Sequel film, trailer', game: 'Game sequel' };

function dateLine(t) {
  const tag = `<span class="tag ${t.dateStatus}">${t.dateStatus}</span>`;
  const days = t.daysLeft !== null && t.daysLeft !== undefined && t.daysLeft >= 0 ? `<div class="src">${t.daysLeft} days left${t.daysLeft < 30 ? '. Late: trailer music is often chosen weeks ahead, so this may only reach later spots.' : ''}</div>` : '';
  const prod = t.production ? `<div class="src">Production: ${esc(t.production)}. No countdown for series.</div>` : '';
  const rel = t.release ? `<div class="src">Release ${fmtDate(t.release)}, announced</div>` : '';
  return `${esc(t.event)} ${fmtDate(t.date)} ${tag}${days}${rel}${prod}`;
}

function clearanceBlock(c) {
  const src = c.sources.length ? `<div class="src">Source: ${c.sources.map(esc).join(', ')}</div>` : '';
  if (c.category === 'unconfirmed') return `Unconfirmed<div class="src">${esc(c.reason)}</div>`;
  const paths = [c.paths.cover?.text, c.paths.original?.text].filter(Boolean).map((p) => `<div class="src">${esc(p)}</div>`).join('');
  return `${esc(c.label)}${paths}${src}`;
}

function overlapLine(d) {
  if (d.overlap === null || d.overlap === undefined) return '<span class="src">Qloo has no age and gender data for this audience.</span>';
  return `<span class="src">${Math.round(d.overlap * 100)}% age and gender overlap with ${esc(d.window.earlier.label)} fans. Used only to break ties.</span>`;
}

const num = (v) => Number(v).toLocaleString('en-US');

// "Qloo says" = Qloo's own numbers, as ranks. "Our read" = the score we compute from them.
function scoreRows(d, state) {
  const b = d.blend;
  if (!b) return `<div><dt>Audience score</dt><dd><span class="src">Qloo has too little data on ${esc(d.window.earlier.label)} fans to rank ${esc(state.artist.name)}.</span></dd></div>`;
  const tested = d.window.kind === 'series'
    ? 'Past series: not clearly ahead of popularity. Treat it as a lead.'
    : 'Past film and game sequels: ahead of popularity (+0.10 AUC). Across all 26 sequels this score cleared our bar: +0.08 AUC over popularity and +10 top-50 hits over the LLM.';
  return `<div><dt>Qloo says</dt><dd>${esc(d.window.earlier.label)} fans: No. ${num(b.affinityRank)} of ${num(b.of)} artists by affinity. No. ${num(b.popularityRank)} by popularity.${d.audienceTop?.length ? `<div class="src">Their top 5 by affinity: ${d.audienceTop.map(esc).join(', ')}.</div>` : ''}</dd></div>
    <div><dt>Our read</dt><dd><span class="big">Top ${d.topPct}%</span><div class="src">No. ${num(b.rank)} of ${num(b.of)} with the two ranks averaged, a score we chose after the backtest (Trust). ${tested}</div></dd></div>`;
}

function renderModes() {
  if (!$('#modes')) return;
  const m = ui.data?.mode || ui.trust?.mode;
  if (!m) return;
  $('#modes').innerHTML = `<span class="pill ${m.qloo === 'MOCK' ? 'mock' : ''}">Qloo ${m.qloo === 'MOCK' ? 'MOCK data' : 'live'}</span>` +
    (m.letters ? `<span class="pill">Letters: ${m.letters === 'OpenAI' && !Object.values(ui.data?.letters || {}).some((l) => l.error) ? 'OpenAI' : 'template'}</span>` : '');
}

const monthLabel = (ym) => (ym ? new Date(ym + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
const lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

function pageviewsLink(q) {
  if (!q.page || !q.window) return '';
  const u = `https://pageviews.wmcloud.org/?project=en.wikipedia.org&platform=all-access&agent=user&redirects=0&start=${q.window.from}-01&end=${lastDay(q.window.to)}&pages=${encodeURIComponent(q.page.replace(/ /g, '_'))}`;
  return ` <a href="${esc(u)}" target="_blank" rel="noopener">See the page views</a>`;
}

function quietLine(q, name) {
  if (q.basis !== 'Wikipedia page views') {
    if (q.quiet === null || q.quiet === undefined) return `Quiet check pending. ${esc(q.detail || '')}`;
    return `${esc(name)} is ${q.quiet ? '' : 'not '}quiet. ${esc(q.detail || '')} Basis: ${esc(q.basis)}.`;
  }
  const facts = `English Wikipedia views, last 3 months: ${q.ratio}x its 3-year average.`;
  const cat = q.catalogue;
  const year = cat?.latest?.date ? cat.latest.date.slice(0, 4) : '';
  if (q.quiet) return `<strong>${esc(name)} is quiet.</strong> Wikipedia views are flat (${q.ratio}x their 3-year average, no spike in 2 years). Last studio album: ${esc(cat?.latest?.title || '')}, ${year}.${pageviewsLink(q)}`;
  if (q.pageviewsQuiet && cat?.old === false) return `${esc(name)} is not a catalogue act right now: a new studio album, ${esc(cat.latest.title)}, came out in ${year} (MusicBrainz). Page views alone look quiet (${q.ratio}x over the last 3 months).${pageviewsLink(q)}`;
  if (q.pageviewsQuiet) return `${esc(name)}: page views look quiet (${q.ratio}x over the last 3 months), but we could not confirm the catalogue on MusicBrainz (${esc(cat?.why || 'not checked')}), so we do not count it as quiet.${pageviewsLink(q)}`;
  const why = q.noWake === false
    ? `${monthLabel(q.peakMonth)} reached ${q.peakRatio}x its 3-year average on English Wikipedia, above the 1.5x line for a wake-up.`
    : `English Wikipedia views over the last 3 months run at ${q.ratio}x its 3-year average, so attention is rising.`;
  return `${esc(name)} is not quiet right now. ${why}${pageviewsLink(q)}`;
}

function renderToday() {
  const el = $('#tab-today');
  const { state, letters } = ui.data;
  const knock = state.doors.filter((d) => d.action === 'letter');
  const skip = state.doors.filter((d) => d.action === 'skip');
  if (!knock.find((d) => d.id === ui.selected)) ui.selected = knock[0]?.id || null;
  const door = knock.find((d) => d.id === ui.selected);

  const lede = `<p class="kicker">For sync teams at music publishers and catalogue owners</p>` + (door
    ? `<h1 class="headline">Pitch ${esc(state.artist.name)} for ${esc(titleOf(knock[0].window))}</h1>`
    : `<h1 class="headline">No pitch today for ${esc(state.artist.name)}</h1>`) +
    `<p class="what">Sleeper Hit checks that an artist has gone quiet, finds upcoming sequels whose audience already ranks them near the top in Qloo, checks clearance and drafts the letter. A person sends it.</p>`;
  const quiet = `<p class="quietline">${quietLine(state.quiet, state.artist.name)}</p>`;

  let desk = '';
  if (door) {
    const saved = outbox().find((l) => l.doorId === door.id && l.artistKey === state.artist.key && l.status !== 'sent');
    if (saved && ui.edits[door.id] === undefined) { ui.edits[door.id] = saved.text; if (saved.song) ui.songs[door.id] = saved.song; }
    const text = ui.edits[door.id] ?? letters[door.id]?.text ?? '';
    if (ui.songs[door.id] === undefined) ui.songs[door.id] = letters[door.id]?.song || state.artist.songs[0] || null;
    const chosen = ui.songs[door.id];
    const L = letters[door.id] || {};
    const how = L.engine === 'openai' ? 'Drafted with OpenAI from the evidence card.' : L.error ? `Drafted from a template: the OpenAI call failed (${esc(L.error)}).` : 'Drafted from a template (no OpenAI key).';
    const engine = `${how} Qloo stops at the artist, so a person picks the song; we have no licensing history, so check recent uses first. Edit anything.`;
    const inOutbox = outbox().find((l) => l.doorId === door.id && l.artistKey === state.artist.key && l.status !== 'sent');
    desk = `
      ${knock.length > 1 ? `<div class="switch" role="group" aria-label="Letters today">${knock.map((d, i) => `<button data-door="${d.id}" aria-pressed="${d.id === door.id}">${i + 1}. ${esc(d.window.title)}</button>`).join('')}</div>` : ''}
      <div class="desk">
        <div>
          <div class="sheet" id="sheet">
            <label class="sr" for="letter">Pitch letter</label>
            <textarea id="letter" spellcheck="true">${esc(text)}</textarea>
            <div class="sheet-foot">
              <div class="songs"><span class="label">Song</span>${state.artist.songs.map((s) => `<button data-song="${esc(s)}" aria-pressed="${chosen === s}">${esc(s)}</button>`).join('')}</div>
              <button class="btn quiet" id="redraft">Redraft</button>
              <button class="btn primary" id="add">${inOutbox ? 'Update in outbox' : 'Add to outbox'}</button>
              <div class="engine">${engine}</div>
            </div>
          </div>
        </div>
        <aside class="card" aria-label="Evidence">
          <h2>${esc(titleOf(door.window))}</h2>
          <p class="kind">${esc(kindLabel[door.window.kind] || '')}${door.window.platform ? `, ${esc(door.window.platform)}` : ''}</p>
          <dl>
            <div><dt>Pitching for</dt><dd>${esc(door.timing.use || '')}</dd></div>
            ${scoreRows(door, state)}
            <div><dt>Clearance</dt><dd>${clearanceBlock(door.clearance)}<details class="notes"><summary>Notes and sources</summary>${state.artist.clearanceNote ? `<div class="src">${esc(state.artist.clearanceNote)}</div>` : ''}${state.artist.sources?.length ? `<div class="src">${state.artist.sources.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">Source ${i + 1}</a>`).join(', ')}</div>` : ''}<div class="src">For setting priorities, not legal advice.</div></details></dd></div>
            <div><dt>Date</dt><dd>${dateLine(door.timing)}</dd></div>
            <div><dt>Audience overlap</dt><dd>${overlapLine(door)}</dd></div>
          </dl>
          ${door.window.note ? `<p class="note">${esc(door.window.note)}</p>` : ''}
        </aside>
      </div>`;
  }

  const allUnconfirmed = state.doors.every((d) => d.clearance.category === 'unconfirmed');
  const manual = allUnconfirmed ? `
    <form class="manual" id="manual">
      <p style="width:100%;margin:0;color:var(--muted)">Clearance is unconfirmed for ${esc(state.artist.name)}, so no letters. ${esc(state.doors[0]?.clearance.reason || '')} If you hold rights, enter your share. It will be marked "Manual".</p>
      <label>Your share of the song (%)<input name="pub" type="number" min="0" max="100" required></label>
      <label>Your share of the recording (%)<input name="mas" type="number" min="0" max="100" required></label>
      <button class="btn quiet">Save my share</button>
    </form>` : '';

  const oneReason = skip.length > 1 && skip.every((d) => d.reason === skip[0].reason) ? (allUnconfirmed ? 'Clearance unconfirmed.' : skip[0].reason) : null;
  const skips = skip.length ? `
    <div class="skipped">
      <h3>${door ? 'Not pitching today' : 'Open windows, and why not today'}</h3>
      ${oneReason ? `<p class="onereason">${esc(oneReason)}</p>` : ''}
      <div class="skips">${skip.map((d) => `
        <div class="skip">
          <strong>${esc(titleOf(d.window))}</strong>
          ${oneReason ? '' : `<p>${esc(allUnconfirmed ? 'Clearance unconfirmed.' : d.reason)}</p>`}
          ${d.topPct ? `<span class="meta">Card score: top ${d.topPct}% for ${esc(d.window.earlier.label)} fans</span>` : ''}
          <span class="meta">${esc(d.timing.event)} ${fmtDate(d.timing.date)}, ${esc(d.timing.dateStatus)}</span>
          ${d.clearance.category !== 'unconfirmed' ? `<button class="btn link" data-override="${d.id}">Knock anyway</button>` : ''}
        </div>`).join('')}
      </div>
    </div>` : '';

  const warn = state.warnings?.length ? `<p class="src" style="color:var(--est)">${state.warnings.map(esc).join('<br>')}</p>` : '';
  el.innerHTML = lede + quiet + desk + manual + skips + warn;

  const ta = $('#letter');
  if (ta) {
    const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    fit();
    ta.addEventListener('input', () => { ui.edits[door.id] = ta.value; fit(); });
    ta.addEventListener('focus', () => $('#sheet').classList.add('editing'));
    ta.addEventListener('blur', () => $('#sheet').classList.remove('editing'));
  }
  el.querySelectorAll('[data-door]').forEach((b) => b.addEventListener('click', () => { ui.selected = b.dataset.door; renderToday(); }));
  el.querySelectorAll('[data-song]').forEach((b) => b.addEventListener('click', () => pickSong(door, b.dataset.song)));
  $('#redraft')?.addEventListener('click', () => redraft(door));
  $('#add')?.addEventListener('click', () => addToOutbox(door));
  el.querySelectorAll('[data-override]').forEach((b) => b.addEventListener('click', () => override(b.dataset.override)));
  $('#manual')?.addEventListener('submit', saveManual);
}

function pickSong(door, song) {
  const prev = ui.songs[door.id];
  let text = ui.edits[door.id] ?? ui.data.letters[door.id]?.text ?? '';
  if (prev) text = text.split(`"${prev}"`).join(`"${song}"`).split(prev).join(song);
  else text = text.replace('Subject: [Song]', `Subject: ${song}`).split('[Song]').join(`"${song}"`);
  ui.songs[door.id] = song;
  ui.edits[door.id] = text;
  renderToday();
}

// Viewer data lives in this browser (the server keeps nothing between restarts).
const store = {
  mem: {},
  read(k, d) { try { const v = localStorage.getItem('sh.' + k); return v === null ? (store.mem[k] ?? d) : JSON.parse(v); } catch { return store.mem[k] ?? d; } },
  write(k, v) { store.mem[k] = v; try { localStorage.setItem('sh.' + k, JSON.stringify(v)); } catch { /* private mode: memory only */ } },
};
const outbox = () => store.read('outbox', []);
const saveOutbox = (list) => store.write('outbox', list);
const overridesFor = (artist, date) => store.read('overrides', []).filter((o) => o.artist === artist && o.date === date).map((o) => o.doorId);
const manualFor = (artist) => store.read('manual', {})[artist] || null;

function viewerQuery() {
  const q = new URLSearchParams();
  if (ui.artist) q.set('artist', ui.artist);
  const date = ui.data?.state?.today || new Date().toISOString().slice(0, 10);
  const ov = overridesFor(ui.artist, date);
  if (ov.length) q.set('overrides', ov.join(','));
  const m = manualFor(ui.artist);
  if (m) { q.set('pub', m.pub); q.set('mas', m.mas); }
  return q;
}

async function redraft(door) {
  try {
    const q = Object.fromEntries(viewerQuery());
    const d = await api('/api/draft', { method: 'POST', body: { ...q, doorId: door.id, song: ui.songs[door.id] || null } });
    ui.data.letters[door.id] = d;
    delete ui.edits[door.id];
    renderToday();
    toast('Redrafted.');
  } catch (e) { toast(e.message); }
}

// One pitch per artist and window, wherever it was added (Today or Works).
const sameName = (a, b) => String(a || '').toLowerCase().trim() === String(b || '').toLowerCase().trim();
const pitchFor = (artistName, doorId) => outbox().find((l) => sameName(l.artistName, artistName) && l.doorId === doorId && l.status === 'sent');
const sentDay = (l) => new Date(l.sentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function addToOutbox(door) {
  const text = ui.edits[door.id] ?? ui.data.letters[door.id]?.text ?? '';
  const today = ui.data.state.today;
  const sent = pitchFor(ui.data.state.artist.name, door.id);
  if (sent) { toast(`Already pitched ${sent.artistName} for ${sent.title} on ${sentDay(sent)}. Not added again.`); return; }
  const list = outbox();
  const existing = list.find((l) => l.artistKey === ui.artist && l.doorId === door.id && l.status !== 'sent');
  if (existing) {
    Object.assign(existing, { text, song: ui.songs[door.id] || null });
  } else {
    const todayCount = list.filter((l) => l.artistKey === ui.artist && l.addedOn === today).length;
    if (todayCount >= ui.data.cap) { toast(`Today's outbox already holds ${ui.data.cap} letters for this artist.`); return; }
    list.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), artistKey: ui.artist, artistName: ui.data.state.artist.name,
      doorId: door.id, title: titleOf(door.window), recipient: door.recipient, text, song: ui.songs[door.id] || null,
      deadline: door.timing.date, addedOn: today, status: 'ready', sentAt: null, used: 'unknown',
    });
  }
  saveOutbox(list);
  renderCount();
  renderToday();
  toast(`${existing ? 'Updated in' : 'Added to'} outbox: ${titleOf(door.window)}.`);
}

function override(doorId) {
  const door = ui.data.state.doors.find((d) => d.id === doorId);
  const log = store.read('overrides', []);
  log.push({ artist: ui.artist, doorId, date: ui.data.state.today, skippedBecause: door?.reason || '', at: new Date().toISOString() });
  store.write('overrides', log);
  ui.selected = doorId;
  load().then(() => toast('Knocking anyway. Logged as your call.'));
}

function saveManual(ev) {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const m = store.read('manual', {});
  m[ui.artist] = { pub: Number(f.get('pub')), mas: Number(f.get('mas')) };
  store.write('manual', m);
  load().then(() => toast('Saved in this browser. Clearance now uses your share (Manual).'));
}

// Works: the viewer's own catalogue. The list and the last result live in this browser; the server
// receives only the names (plus the viewer's own share and song), scores them and keeps nothing.
const WORKS_PER_DAY = 30; // matches the server's default per-visitor cap
const EXAMPLE = ['The Clash, 100, 0, London Calling', 'The Smiths, 100, 0, There Is a Light That Never Goes Out', "The Pointer Sisters, 100, 0, I'm So Excited", 'Fleetwood Mac'].join('\n');
const works = () => store.read('works', { list: [], result: null });
const saveWorks = (w) => { store.write('works', w); renderWorksCount(); };
function renderWorksCount() {
  const n = works().list.length;
  $('#works-count').textContent = n ? String(n) : '';
  $('#header-run').hidden = !n; // only useful once a catalogue is saved
}
const fmtTime = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const shareLine = (a) => (a.share ? `Your share: ${a.share.pub}% of the song, ${a.share.mas}% of the recording` : 'No share entered');

function worksQuiet(a) {
  const q = a.quiet || {};
  const year = q.catalogue?.latest?.date ? q.catalogue.latest.date.slice(0, 4) : '';
  if (q.quiet === true) return `<span class="st go">Quiet</span> <span class="src">views ${q.ratio}x their 3-year average${year ? `, last studio album ${esc(year)}` : ''}</span>`;
  if (q.quiet === false) {
    if (q.pageviewsQuiet && q.catalogue?.old === false) return `<span class="st">Not quiet</span> <span class="src">new studio album in ${esc(year)}</span>`;
    return `<span class="st">Not quiet</span> <span class="src">${q.noWake === false ? `${monthLabel(q.peakMonth)} reached ${q.peakRatio}x on Wikipedia` : `views rising, ${q.ratio}x`}</span>`;
  }
  return `<span class="st">Unknown</span> <span class="src">${esc(q.detail || 'quiet check incomplete')}</span>`;
}

function worksForm(list, open) {
  const example = !list.length;
  return `<form class="works-form" id="works-form" novalidate>
      <label for="works-input"><strong>Your artists</strong>, one per line, up to 10</label>
      <p class="hint" id="works-hint">${example ? '<strong>Filled in with an example; the shares are made up.</strong> Replace it with your own. ' : ''}Format: <span class="fmt">Name, song %, recording %, song</span>. Your share of the song and the recording is what clears a letter; a name alone is scored but gets no letter.</p>
      <textarea id="works-input" rows="5" spellcheck="false" aria-describedby="works-hint works-error">${esc(example ? EXAMPLE : catalogueText(list))}</textarea>
      <p class="field-error" id="works-error" role="alert"></p>
      <div class="works-actions">
        <button class="btn primary" id="works-go">${open ? 'Re-score this list' : 'Score my catalogue'}</button>
        ${example ? '<button class="btn quiet" type="button" id="works-clear">Clear the example</button>' : ''}
      </div>
      <p class="fine">Saved in this browser only; the server scores the names and keeps nothing. Artists outside our 3,000-artist pool cost Qloo calls, so each visitor gets ${WORKS_PER_DAY} artist analyses a day.</p>
    </form>`;
}

// A small record, drawn here (no images): grooves, label, spindle hole.
const DISC = `<svg class="disc" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
  <circle cx="60" cy="60" r="59" fill="var(--ink)"/>
  ${[54, 49, 44, 39, 34, 29].map((r) => `<circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--ground)" stroke-opacity=".16" stroke-width=".7"/>`).join('')}
  <path d="M60 9 A51 51 0 0 1 104 34" fill="none" stroke="var(--ground)" stroke-opacity=".38" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M60 111 A51 51 0 0 1 16 86" fill="none" stroke="var(--ground)" stroke-opacity=".18" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="60" cy="60" r="21" fill="var(--accent)"/>
  <circle cx="60" cy="60" r="2.6" fill="var(--ground)"/>
</svg>`;

const sideLabel = (scannedAt) => `Cat. no. SH-${new Date(scannedAt).toISOString().slice(2, 10).replace(/-/g, '')}`;

function renderWorks() {
  const el = $('#tab-works');
  const w = works();
  const r = w.result;
  if (!r) {
    el.innerHTML = `<div class="sleeve">
      <div class="sleeve-head"><div>
        <h1 class="headline display">Which of your artists to pitch, and for what</h1>
        <p class="what">Paste your artists. Sleeper Hit scores each one against every open sequel window with the same score we backtested, keeps the quiet ones whose sequel audience ranks them in its top 20%, checks your share, and drafts the letters, best first.</p>
      </div>${DISC}</div>
      ${worksForm(w.list, false)}<div id="works-status" aria-live="polite"></div></div>`;
    bindWorksForm();
    return;
  }
  const picks = r.picks || [];
  const lead = picks.find((p) => !pitchFor(p.artist, p.id)) || null;
  const sideB = r.artists.filter((a) => !a.letters);
  const title = lead ? `Pitch ${esc(lead.artist)} for ${esc(lead.title)} ${lead === picks[0] ? 'first' : 'next'}` : picks.length ? 'Every letter on this list is pitched' : 'No pitch from this list today';
  const summary = `${picks.length} letter${picks.length === 1 ? '' : 's'} ready from ${r.artists.length} artist${r.artists.length === 1 ? '' : 's'}, ranked with the same score we backtested and Today’s rules: quiet artists only, top 20% on the card score and in the audience’s own top 20% by affinity, your share confirmed, timing, at most 3 letters per artist a day.`;

  const sideA = picks.length ? `<h2 class="side">Side A · ready to pitch, best first</h2><ol class="tracks">${picks.map((p, i) => `
      <li class="track${i === 0 ? ' lead' : ''}">
        <span class="tno">A${i + 1}</span>
        <div class="tmain">
          <h3>${esc(p.artist)} <em>for</em> ${esc(p.title)}</h3>
          <p class="twhy"><b class="tpct">Top ${p.topPct}%.</b> ${esc(p.earlier)} fans rank them No. ${num(p.affinityRank)} by affinity and No. ${num(p.popularityRank)} by popularity, of ${num(p.of)}. ${esc(p.use)}</p>
          ${p.audienceTop?.length ? `<p class="tmeta">${esc(p.earlier)} fans’ top 5 by affinity: ${p.audienceTop.map(esc).join(', ')}</p>` : ''}
          <p class="tmeta">${esc(p.clearance.label)} · ${esc(p.event)} ${fmtDate(p.date)}, ${esc(p.dateStatus)}${p.song ? ` · “${esc(p.song)}”` : ' · no song given, the letter says [Song]'}</p>
          <details class="tletter"><summary>Letter ready${p.letter.engine === 'openai' ? ', drafted with OpenAI' : p.letter.error ? ', from the template (the OpenAI call failed)' : i >= 3 ? ', from the template (OpenAI drafts the top 3)' : ', from the template'}</summary>
            <label class="sr" for="pick-${i}">Letter for ${esc(p.artist)} and ${esc(p.title)}</label>
            <textarea id="pick-${i}" data-pick="${i}" rows="12">${esc(p.letter.text)}</textarea>
            <div class="works-actions">${pitchFor(p.artist, p.id) ? `<span class="st go">Pitched ${sentDay(pitchFor(p.artist, p.id))}</span>` : `<button class="btn primary" data-add-pick="${i}">Add to outbox</button>`}<a class="btn quiet" data-mail-pick="${i}" href="${esc(mailtoFor(p.letter.text))}">Open in email app</a></div>
          </details>
        </div>
        <span class="tscore"><b>Top ${p.topPct}%</b><span>card score</span></span>
      </li>`).join('')}</ol>` : `<p class="empty-side">No letters today. Side B says why for each artist.</p>`;

  const bTracks = sideB.length ? `<h2 class="side">Side B · not pitching today</h2><ol class="tracks b">${sideB.map((a, i) => `
      <li class="track">
        <span class="tno">B${i + 1}</span>
        <div class="tmain"><h3>${esc(a.name)}</h3><p class="twhy">${esc(a.status === 'scored' ? a.why : a.why)}</p></div>
        <span class="tscore">${a.best ? `<b>Top ${a.best.topPct}%</b><span>best window</span>` : '<span>not ranked</span>'}</span>
      </li>`).join('')}</ol>` : '';

  const notes = `<h2 class="side">Liner notes · every artist you added</h2><div class="notes-grid">${r.artists.map((a) => `
      <section class="lnote" aria-label="${esc(a.name)}">
        <h4>${esc(a.name)} <span>${a.status !== 'scored' ? '' : a.inPool ? 'in our 3,000-artist pool' : 'scored on request'}</span></h4>
        ${a.status !== 'scored' ? `<p class="twhy">${esc(a.why)}</p>` : `
        <dl>
          <dt>Quiet</dt><dd>${worksQuiet(a)}</dd>
          <dt>Best window</dt><dd>${a.best ? `${esc(a.best.title)}, top ${a.best.topPct}% <span class="src">(No. ${num(a.best.affinityRank)} by ${esc(a.best.earlier)} fans’ affinity)</span>` : '<span class="src">Qloo has too little data</span>'}</dd>
          <dt>Clearance</dt><dd>${a.clearance.category === 'unconfirmed' ? 'Unconfirmed' : esc(a.clearance.label)} <span class="src">${esc(shareLine(a))}</span></dd>
          <dt>Today</dt><dd>${a.letters ? `<span class="st go">${a.letters} letter${a.letters === 1 ? '' : 's'}</span>` : esc(a.why)}</dd>
        </dl>
        <details class="wdoors"><summary>All ${a.doors.length} windows</summary><ul>${a.doors.map((d) => `<li><strong>${esc(d.title)}</strong> ${d.topPct ? `top ${d.topPct}%` : 'not ranked'}: ${d.action === 'letter' ? '<span class="st go">letter</span>' : esc(d.reason)}</li>`).join('')}</ul></details>`}
      </section>`).join('')}</div>`;

  el.innerHTML = `<div class="sleeve">
    <div class="sleeve-head"><div>
      <h1 class="headline display">${title}</h1>
      <p class="what">${summary}</p>
      <p class="scanline"><span class="catno">${sideLabel(r.scannedAt)} · last scanned ${fmtTime(r.scannedAt)}</span><button class="btn link" id="works-edit" aria-expanded="false" aria-controls="works-editor">Edit the list</button></p>
    </div>${DISC}</div>
    <div id="works-status" aria-live="polite"></div>
    <div id="works-editor" hidden>${worksForm(w.list, true)}</div>
    ${sideA}${bTracks}${notes}</div>`;
  el.querySelectorAll('[data-add-pick]').forEach((b) => b.addEventListener('click', () => addPickToOutbox(Number(b.dataset.addPick))));
  el.querySelectorAll('textarea[data-pick]').forEach((ta) => ta.addEventListener('input', () => {
    const i = Number(ta.dataset.pick); const cur = works(); cur.result.picks[i].letter.text = ta.value; saveWorks(cur);
    el.querySelector(`[data-mail-pick="${i}"]`).href = mailtoFor(ta.value);
  }));
  el.querySelectorAll('[data-mail-pick]').forEach((a) => a.addEventListener('click', () => toast('Opening your email app. Sleeper Hit does not send anything itself.')));
  $('#works-edit').addEventListener('click', (e) => { const ed = $('#works-editor'); ed.hidden = !ed.hidden; e.target.setAttribute('aria-expanded', String(!ed.hidden)); if (!ed.hidden) $('#works-input').focus(); });
  bindWorksForm();
}

function bindWorksForm() {
  const err = (m) => { const e = $('#works-error'); if (e) e.textContent = m; if (m) $('#works-input')?.setAttribute('aria-invalid', 'true'); else $('#works-input')?.removeAttribute('aria-invalid'); };
  $('#works-clear')?.addEventListener('click', (e) => { $('#works-input').value = ''; err(''); e.target.remove(); $('#works-input').focus(); });
  $('#works-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const list = parseCatalogue($('#works-input').value);
    if (!list.length) { err('Add at least one artist name, one per line.'); $('#works-input').focus(); return; }
    if (list.length > 10) { err(`Up to 10 artists per scan. This list has ${list.length}; remove ${list.length - 10}.`); $('#works-input').focus(); return; }
    err('');
    scanWorks(list);
  });
}

async function scanWorks(list) {
  const status = $('#works-status');
  const btn = $('#header-run');
  if (btn) { btn.disabled = true; btn.textContent = 'Scanning…'; }
  const go = $('#works-go');
  if (go) { go.disabled = true; go.textContent = 'Scoring…'; }
  $('#tab-works .disc')?.classList.add('spinning');
  if (status) status.innerHTML = `<p class="progress">Scoring ${list.length} artist${list.length === 1 ? '' : 's'} against every open window. Checking Wikipedia and MusicBrainz for each one can take up to a minute.</p>`;
  try {
    const result = await api('/api/works/scan', { method: 'POST', body: { artists: list } });
    saveWorks({ list, result });
    renderWorks();
    toast(`Scanned. ${result.left.visitor} artist analyses left today.`);
  } catch (e) {
    saveWorks({ ...works(), list });
    if ($('#works-status')) $('#works-status').innerHTML = `<p class="error" role="alert">${esc(e.message)}</p>`;
    else toast(e.message);
    if (go) { go.disabled = false; go.textContent = 'Score my catalogue'; }
    $('#tab-works .disc')?.classList.remove('spinning');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Re-scan works'; }
  }
}

function addPickToOutbox(i) {
  const w = works();
  const p = w.result.picks[i];
  const key = 'works:' + p.artist.toLowerCase();
  const sent = pitchFor(p.artist, p.id);
  if (sent) { toast(`Already pitched ${p.artist} for ${p.title} on ${sentDay(sent)}. Not added again.`); return; }
  const list = outbox();
  const existing = list.find((l) => sameName(l.artistName, p.artist) && l.doorId === p.id && l.status !== 'sent');
  if (existing) Object.assign(existing, { text: p.letter.text });
  else list.push({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), artistKey: key, artistName: p.artist,
    doorId: p.id, title: p.title, recipient: p.recipient, text: p.letter.text, song: p.song || null,
    deadline: p.date, addedOn: w.result.today, status: 'ready', sentAt: null, used: 'unknown',
  });
  saveOutbox(list);
  renderCount();
  toast(`${existing ? 'Updated in' : 'Added to'} outbox: ${p.artist} for ${p.title}.`);
}

function renderCount() {
  const open = outbox().filter((l) => l.status !== 'sent').length;
  $('#outbox-count').textContent = open ? String(open) : '';
}

const OUTCOMES = [['unknown', 'No reply yet'], ['passed', 'Passed'], ['hold', 'On hold'], ['quote', 'Quote requested'], ['placed', 'Placed']];

function renderOutbox() {
  const el = $('#tab-outbox');
  const note = '<p class="note-store">Saved in this browser only; the server keeps no copy. Sleeper Hit never sends email itself: “Open in email app” opens a filled-in draft in your own email program, and you send it.</p>';
  const list = [...outbox()].sort((a, b) => (a.status === 'sent') - (b.status === 'sent') || String(a.deadline).localeCompare(String(b.deadline)));
  if (!list.length) { el.innerHTML = '<p class="empty">No letters yet. Add one from Today. Up to three a day per artist.</p>' + note; return; }
  const sent = list.filter((l) => l.status === 'sent');
  const tally = sent.length ? `<p class="tally">${sent.length} sent. ${OUTCOMES.map(([v, t]) => `${t}: ${sent.filter((l) => l.used === v).length}`).join('. ')}.</p>` : '';
  const today = ui.data?.state?.today || new Date().toISOString().slice(0, 10);
  const days = (iso) => Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
  el.innerHTML = note + tally + `<div class="list">${list.map((l) => `
    <div class="row" data-id="${esc(l.id)}">
      <div><h3>${esc(l.title)}</h3><div class="sub">${esc(l.artistName || '')}${l.song ? `, "${esc(l.song)}"` : ''}. ${esc(l.recipient)}</div></div>
      <div class="actions">
        ${l.status === 'sent'
          ? `<span class="status-sent">Sent ${new Date(l.sentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
             <label class="used">Outcome <select data-used>${OUTCOMES.map(([v, t]) => `<option value="${v}"${l.used === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`
          : `<button class="btn quiet" data-copy>Copy letter</button><button class="btn quiet" data-send>Mark sent</button><button class="btn link" data-remove>Remove</button>`}
      </div>
      <div class="sub">${l.deadline ? `Window date ${fmtDate(l.deadline)}${l.deadline.length === 10 ? `, ${days(l.deadline)} days left` : ''}` : ''}</div>
      <div class="mailrow"><label>Send to <input type="email" data-to value="${esc(l.to || '')}" placeholder="Their address (optional)" autocomplete="off"></label><a class="btn quiet" data-mail href="${esc(mailtoFor(l.text, l.to))}">Open in email app</a></div>
      <details><summary>Edit letter</summary><textarea data-text>${esc(l.text)}</textarea></details>
    </div>`).join('')}</div>`;
  el.querySelectorAll('.row').forEach((row) => {
    const id = row.dataset.id;
    const patch = (changes, msg) => {
      const all = outbox();
      const l = all.find((x) => x.id === id);
      if (!l) return;
      Object.assign(l, changes);
      saveOutbox(all);
      renderCount();
      renderOutbox();
      if (msg) toast(msg);
    };
    row.querySelector('[data-copy]')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(row.querySelector('[data-text]').value); toast('Copied. Mark it sent once you have sent it.'); } catch { toast('Copy was blocked by the browser. Open "Edit letter" and copy it there.'); }
    });
    row.querySelector('[data-send]')?.addEventListener('click', () => {
      patch({ status: 'sent', sentAt: new Date().toISOString(), text: row.querySelector('[data-text]').value }, 'Marked as sent. Track the outcome here.');
    });
    row.querySelector('[data-remove]')?.addEventListener('click', () => { saveOutbox(outbox().filter((x) => x.id !== id)); renderCount(); renderOutbox(); });
    row.querySelector('[data-used]')?.addEventListener('change', (e) => patch({ used: e.target.value }, 'Saved.'));
    row.querySelector('[data-text]')?.addEventListener('change', (e) => patch({ text: e.target.value }, 'Letter saved.'));
    const mail = row.querySelector('[data-mail]');
    const syncMail = () => { mail.href = mailtoFor(row.querySelector('[data-text]').value, row.querySelector('[data-to]').value); };
    row.querySelector('[data-to]').addEventListener('input', syncMail);
    row.querySelector('[data-text]').addEventListener('input', syncMail);
    row.querySelector('[data-to]').addEventListener('change', (e) => {
      const all = outbox(); const l = all.find((x) => x.id === id); if (l) { l.to = e.target.value.trim(); saveOutbox(all); }
    });
    mail.addEventListener('click', () => toast(`Opening your email app. Mark it sent here once you send it.`));
  });
}

function renderTrust() {
  const el = $('#tab-trust');
  const t = ui.trust;
  if (!t) { el.innerHTML = '<p class="loading">Loading…</p>'; return; }
  const j = t.judging;
  const pct = (v) => (v === null || v === undefined ? '–' : v.toFixed(2));

  const seal = t.seal
    ? `<p>Sealed ${new Date(t.seal.sealedAt).toUTCString()}${t.seal.mode !== 'live' ? ' with MOCK data (not the real forecast)' : ''}. The files stay private${t.seal.encrypted ? ' and encrypted' : ''}; the hashes below are public.</p>
       <table><tr><th>File</th><th>SHA-256</th></tr>${t.seal.files.map((f) => `<tr><td>${esc(f.label || f.file)}</td><td class="hash">${esc(f.sha256)}</td></tr>`).join('')}</table>`
    : `<p>Not sealed yet. Before the Oct 30 deadline the agent ranks the whole pool for every candidate title below and publishes three SHA-256 hashes here and in the submission text: the pool list, the per-title ranks, and the baseline predictions. The files stay private, because Qloo data may not sit in a public repository.</p>`;
  const r = t.results;
  const results = r
    ? `<p>Settled ${fmtDate(r.settledAt.slice(0, 10))}: ${r.titlesWithLists} title${r.titlesWithLists === 1 ? '' : 's'} with public song lists, ${r.positives} new artists from the pool. Pooled AUC: Qloo ${pct(r.pooledAuc.qloo)}, popularity ${pct(r.pooledAuc.popularity)}, LLM ${pct(r.pooledAuc.llm)}, similar titles ${pct(r.pooledAuc.similarTitles)}. Verdict: <strong>${esc(r.verdict)}</strong> (${esc(r.why)}).</p>`
    : `<p>No title has been settled yet.</p>`;
  const timeline = `
    <ol class="steps">
      <li><strong>By Oct 30.</strong> Seal and publish the hashes.</li>
      <li><strong>Judging, ${fmtDate(j.start)} to ${fmtDate(j.end)}.</strong> Almost nothing can be checked yet. Black Doves season 2 is the only sealed title out by then (Nov 5, the last judging day), and its first season's list suggests about one new pool artist. That is too few to count, and we say so instead of reporting a number. What you can check now is the backtest below and the code that will do the settling.</li>
      <li><strong>After release.</strong> Each title is settled as its songs become public: a person adds the public list, <code>npm run settle</code> checks the hashes and scores the forecast with the same scorer as the backtest. Sonic 4's first trailer (estimated mid-November), GTA VI's launch (Nov 19) and Yellowjackets season 4 (Nov 20) come next. Names and ranks are unsealed at the first settlement.</li>
      <li><strong>${fmtDate(j.finalSettle)}.</strong> Final settlement. Fewer than 10 new artists by then means no result, reported as such.</li>
    </ol>
    <p>Pass, fixed before the seal: pooled AUC 0.65 or higher and above popularity, the LLM and what similar titles used. 0.55 or lower, or not above popularity or the LLM, is a fail. The sealed Qloo ranking is the card score, the affinity + popularity rank blend. We switched to it after the backtest (see below); the original excess-affinity ranking is sealed too and will be reported next to it, but does not decide the verdict.</p>`;

  const b = t.backtest;
  const names = { popularity: 'Popularity', llm: 'LLM only', similarTitles: 'What similar titles used', qlooRaw: 'Qloo raw affinity', qlooExcess: 'Qloo excess affinity (card score until Oct 23)', qlooTimesPop: 'Qloo affinity x popularity', qlooBlend: 'Qloo affinity + popularity rank blend (card score)', llmTail: 'LLM, lower third only' };
  const iv = (o, f = pct) => (o ? `${f(o.value)} <span class="src">[${f(o.lo)}, ${f(o.hi)}]</span>` : '–');
  const n0 = (v) => (v === null || v === undefined ? '–' : String(Math.round(v)));
  const sgn = (v) => (v === null || v === undefined ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`);
  const sgn3 = (v) => (v === null || v === undefined ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(3)}`);
  const sgn0 = (v) => (v === null || v === undefined ? '–' : `${v > 0 ? '+' : ''}${Math.round(v)}`);
  const methodTable = (s) => `<table><tr><th>Method</th><th>Pooled AUC</th><th>Hits in top 50</th></tr>${Object.keys(s.pooledAuc).map((k) => `<tr><td>${esc(names[k] || k)}</td><td>${iv(s.pooledAuc[k])}</td><td>${iv(s.hits[k], n0)}</td></tr>`).join('')}</table>`;
  const h1 = b?.hypotheses?.H1 || {};
  const passed = Object.entries(h1).filter(([, v]) => v?.holds).map(([k]) => names[k] || k);
  const sc = t.siblingCheck;
  const sib = sc ? `<p>Close sibling titles (${sc.siblingPairs} pairs, such as consecutive Twilight films, GTA V and Red Dead Redemption 2, Bridgerton and The Gilded Age) against ${sc.randomPairs} unrelated pairs, registered before it ran. Bar: top-50 overlap at least 3x random with p below 0.01. ${['qlooRaw', 'qlooExcess', 'llm'].map((k) => { const r = sc.results[k]; return `${esc(names[k].replace(/ \(card score.*\)/, ''))}: ${r.ratio}x, p ${r.p < 0.001 ? '< 0.001' : r.p}, ${r.pass ? 'passed' : 'not passed'}`; }).join('; ')}. The link to release-year distance is weak, so the overlap reflects the audience, not just when the data was collected.</p>` : '';
  const thirdName = (k) => (k === 'high' ? 'Most popular third' : k === 'mid' ? 'Middle third' : 'Least popular third');
  const tert = b ? ['high', 'mid', 'low'].map((k) => {
    const s = b.byTertile[k];
    const best = s.qlooVs?.qlooBlend;
    const llmCell = k === 'low' ? `${n0(s.hits?.llm?.value)} <span class="src">(given only these 1,000 names: ${n0(s.hits?.llmTail?.value)})</span>` : n0(s.hits?.llm?.value);
    return `<tr><td>${thirdName(k)}</td><td>${s.positives}</td><td>${iv(s.pooledAuc?.qlooBlend)}</td><td>${iv(s.pooledAuc?.popularity)}</td><td>${best ? `${sgn(best.aucMinusPopularity.value)} <span class="src">[${sgn(best.aucMinusPopularity.lo)}, ${sgn(best.aucMinusPopularity.hi)}]</span>` : '–'}</td><td>${n0(s.hits?.qlooBlend?.value)}</td><td>${llmCell}</td></tr>`;
  }).join('') : '';
  const ov = b?.overall, bl = ov?.qlooVs?.qlooBlend, ex = ov?.qlooVs?.qlooExcess;
  const hi = b?.byTertile.high.qlooVs.qlooBlend, fl = b?.films?.qlooVs?.qlooBlend;
  const midLow = b ? ['mid', 'low'].map((k) => b.byTertile[k].qlooVs.qlooBlend.aucMinusPopularity) : [];
  const ci = (o, f = sgn) => (o ? `${f(o.value)} [${f(o.lo)}, ${f(o.hi)}]` : '–');
  const sch = t.scoreChange;
  const bars = b ? (() => {
    const rows = [['qlooBlend', 'Qloo card score'], ['qlooRaw', 'Qloo raw affinity (did not clear)'], ['qlooTimesPop', 'Qloo affinity x popularity (did not clear)'], ['llm', 'LLM only'], ['similarTitles', 'What similar titles used'], ['popularity', 'Popularity']].filter(([k]) => ov.hits[k]);
    const max = Math.max(...rows.map(([k]) => ov.hits[k].value));
    return `<div class="bars" role="img" aria-label="Sequel artists found in the top 50">${rows.map(([k, label]) => `<div class="barrow${k === 'qlooBlend' ? ' lead' : ''}"><span class="barlabel">${label}</span><span class="bartrack"><span class="barfill" style="width:${(ov.hits[k].value / max) * 100}%"></span></span><span class="barval">${n0(ov.hits[k].value)} <span class="of">of ${b.positives}</span></span></div>`).join('')}</div>`;
  })() : '';
  const usesTable = b ? `<table><tr><th>Qloo use (registered before the test)</th><th>AUC over popularity</th><th>Top-50 hits over the LLM</th><th>Cleared the bar</th></tr>${['qlooRaw', 'qlooExcess', 'qlooTimesPop', 'qlooBlend'].map((k) => { const v = ov.qlooVs[k]; return `<tr><td>${esc(names[k])}</td><td>${ci(v.aucMinusPopularity)}</td><td>${ci(v.hitsMinusLlm, sgn0)}</td><td>${h1[k]?.holds ? '<strong>Yes</strong>' : 'No'}</td></tr>`; }).join('')}</table>` : '';
  const backtest = b ? `
    <p class="claim">On ${b.pairsScored} sequels already out, the earlier title's Qloo audience rank, averaged with popularity, put the artists each sequel went on to use higher than popularity alone or an LLM did. Audience rank alone pointed the same way but did not clear our bar.</p>
<p class="story">One of 12 sequels where the card score found an artist that neither popularity nor the LLM did: the soundtrack of <em>Guardians of the Galaxy Vol. 2</em> includes Fleetwood Mac, and ranked from the first film's Qloo audience, Fleetwood Mac was in our top 50 of about 3,000 artists. Qloo's data is today's, so fans of the first film have also seen Vol. 2. That bias favours Qloo; the sealed forecast is the clean test.</p>
    <p class="sub">Sequel artists found in each method's top 50, summed over ${b.pairsScored} sequels (${b.positives} to find). Raw affinity and affinity x popularity found more (${n0(ov.hits.qlooRaw?.value)} each) but did not clear the registered bar: raw affinity missed both parts, and affinity x popularity cleared the AUC part but not the hits-over-the-LLM part. The card score is the only Qloo use that cleared both (table below).</p>
    ${bars}
    <ul class="wins">
      <li><strong>Famous artists, the ones this tool pitches.</strong> Every top-50 hit of the card score and of the LLM was in the most popular third of the pool, which holds the 500 artists the selection rule picks from (The Clash is No. 109). Within that third, the card score also beat popularity by ${ci(hi?.aucMinusPopularity)} AUC.</li>
      <li><strong>Films and games.</strong> On the ${b.films.pairs} film and game sequels: ${ci(fl?.aucMinusPopularity)} AUC over popularity, and ${n0(b.films.hits.qlooBlend.value)} top-50 hits against the LLM's ${n0(b.films.hits.llm.value)} (${ci(fl?.hitsMinusLlm, sgn0)}).</li>
      <li><strong>Committed first, score picked after.</strong> The method was committed before any song list was collected (commit <span class="hash">${esc(t.backtestMethod?.commit || b.registeredCommit)}</span>), and <code>npm run backtest</code> re-runs it. Of the four Qloo uses it registered, only the card score cleared the bar, and we switched to it after seeing that (details below). The sealed forecast is the test it has not seen.</li>
    </ul>
    <h3>Limits</h3>
    <ul>
      <li>Series (${b.series.pairs} pairs, AUC ${ci(b.series.qlooVs.qlooBlend.aucMinusPopularity, sgn3)} over popularity) and titles released after the LLM's training cutoff (${b.afterCutoff.pairs} pairs, ${ci(b.afterCutoff.qlooVs.qlooBlend.aucMinusPopularity, sgn3)}) did not show Qloo clearly ahead of popularity. Most sealed titles are one or the other.</li>
      <li>The backtest checks songs used in the sequels themselves (soundtrack albums and episode lists). The app pitches trailers and TV spots too, where picks follow other rules.</li>
      <li>The LLM is <code>gpt-4.1-mini</code> at temperature 0, given both titles and the pool. It returns a 50-name shortlist, not a full ranking, so we could not test an LLM-plus-popularity blend against ours.</li>
      <li>Less famous artists: inside the middle and least popular thirds, ranking only those artists, the card score beat popularity by ${sgn(midLow[0]?.value)} and ${sgn(midLow[1]?.value)} AUC. But asked for 50 names from the whole pool, the LLM put all 50 in the most popular third, so it never competed there. Given only the least popular ${num(b.pool / 3)} names, it found as many sequel artists as Qloo (${n0(b.byTertile.low.hits.llmTail?.value)} vs ${n0(b.byTertile.low.hits.qlooBlend.value)}).</li>
      <li>"Least popular" means the bottom of a popular pool (Qloo popularity 0.9 or higher), not the long tail.</li>
      <li>Four Qloo uses were tested without correcting for that, so one pass is a narrow pass.</li>
      <li>Known biases, written down before scoring: ${(t.backtestMethod?.knownBiases || []).map(esc).join(' ')}</li>
    </ul>
    <details><summary>All methods and the four Qloo uses</summary>
      <p>${b.candidates} past sequels listed; ${b.pairsScored} had sequel artists in the ${num(b.pool)}-artist pool who were not on the earlier title's list, ${b.positives} in all (${b.films.pairs} films and games, ${b.series.pairs} series). Pooled AUC: 0.5 is chance. Intervals: 95%, resampling franchises.</p>
      <div class="tablewrap">${methodTable(b.overall)}</div>
      <p>Registered bar: a Qloo use beats popularity on AUC and the LLM on top-50 hits, both with the interval's lower end above zero. Raw affinity found more hits, but its lower ends touched or crossed zero. Differences are computed before rounding.</p>
      <div class="tablewrap">${usesTable}</div>
    </details>
    <details><summary>We changed the card score after this test</summary>
      <div class="change"><p>${esc(sch?.text || '')}</p>
      <p>Original score, excess affinity: pooled AUC ${iv(ov?.pooledAuc.qlooExcess)}, ${ci(ex?.aucMinusPopularity)} over popularity, ${ci(ex?.hitsMinusLlm, sgn0)} top-50 hits over the LLM. Not cleared.</p></div>
    </details>
    <details><summary>By popularity third</summary>
      <p>Each third is ranked on its own: the card score's top 50 inside that third. The LLM column counts the LLM's 50 whole-pool picks that fall in that third.</p>
      <div class="tablewrap"><table><tr><th>Pool third</th><th>Sequel artists</th><th>Card score AUC</th><th>Popularity AUC</th><th>Difference</th><th>Top-50 hits, card score</th><th>LLM hits</th></tr>${tert}</table></div>
    </details>
    <details><summary>Sibling titles</summary>${sib}</details>`
    : '<p>Not run yet.</p>';

  const ds = (t.dataSources || []).map((d) => `<li><strong>${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.name)}</a>` : esc(d.name)}.</strong> ${esc(d.use)}</li>`).join('');
  const qu = t.qlooUse;
  const usage = qu ? `<p>${num(qu.liveCalls)} live Qloo calls while building and testing, on ${qu.endpoints.length} endpoints (${qu.endpoints.map((e) => `<code>${esc(e)}</code>`).join(', ')}). Insights for ${qu.insightTypes.map((e) => `<code>${esc(e)}</code>`).join(', ')} (tags tried, then left out); search across ${qu.searchTypes.length} entity types. ${qu.rejected} request was rejected (a trending query over a full year). After a restart the app re-scores the pool once, about ${num(qu.coldStart)} calls, then serves from its private cache.</p>` : '';

  const p = t.premise;
  const premise = p ? `
    <p><span class="verdict ${p.verdict === 'pass' ? '' : 'fail'}">${p.verdict === 'pass' ? 'Passed' : p.verdict === 'fail' ? 'Failed' : 'No data'}</span></p>
    <p>Checked ${new Date(p.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} on ${Number(p.poolSize).toLocaleString('en-US')} artists and ${p.titles} titles${p.mode !== 'live' ? ' (MOCK data, means nothing)' : ''}. Median rank correlation between Qloo affinity and popularity: ${p.medianSpearman?.toFixed(2)}. Median agreement between two titles' rankings: ${p.medianTau?.toFixed(2)}. Low numbers mean each title's audience picks its own artists instead of just the famous ones. The bar was set before the test: correlation 0.5 or lower passes, above 0.8 fails. This shows Qloo measures something popularity does not; the backtest above is where that meets real song choices.</p>`
    : '<p>Not run yet.</p>';

  const tr = t.trending, qc = t.quietCheck, qr = t.rules.quiet, cr = t.rules.catalogue, dp = t.demoPick;
  const demo = dp ? `
    <h3>The demo artist is our pick</h3>
    <p>${esc(dp.text)}</p>
    <ul>${dp.sources.map((s) => `<li>${esc(s.claim)} <a class="srclink" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a></li>`).join('')}</ul>` : '';
  const quiet = `
    <p>Rule, fixed on Oct 23 before the demo artist was re-checked: using English Wikipedia page views (Wikimedia's public API, known bots excluded), an artist is quiet when no month in the last ${qr.noSpikeMonths} rose above ${qr.spikeX} times the ${qr.months}-month average (no recent wake-up) and the last ${qr.recentMonths} months sit at or below that average (not rising now). Page views measure reading attention, not listening, and lean English-speaking. A rights holder can use its own royalty statements instead; the card then says so.</p>
    ${cr ? `<p>Catalogue condition, added later on Oct 23: the page-view rule only compares an artist with its own past, so current stars with a steady audience passed it. A quiet artist must also have released no new studio album in the last ${cr.years} years. A studio album is a MusicBrainz release group with primary type Album and no secondary type, so compilations, live albums, soundtracks and remixes do not count, and groups holding only bootlegs are left out. We find the artist on MusicBrainz through the Wikidata id Qloo carries. An artist we cannot find, or with no dated studio album there, is marked unknown and is not counted as quiet. A posthumous or reunion studio album counts as new. Release groups dated after the check date are ignored, because they are not out yet or are bad data. MusicBrainz is edited by volunteers and can be wrong: on Oct 23 a Beatles album dated November 2026, which we could not find anywhere else, would otherwise have dropped them. We handle this with that general rule, not a hand edit for one artist.</p>` : ''}
    ${demo}
    ${qc ? `<p>Sanity check on three known wake-ups, each as of a date just after the event: ${qc.knownWakeUps.map((k) => `${esc(k.page)}, ${esc(k.event)}: ${!k.caught ? 'missed' : k.peakIsEvent ? `caught (busiest month ${monthLabel(k.peakMonth)}, ${k.peakRatio}x)` : `not quiet, but for another reason (busiest month ${monthLabel(k.peakMonth)}, ${k.peakRatio}x; the trailer month itself stayed under 1.5x)`}`).join('; ')}.</p>` : ''}
    ${tr ? `<p>Why not Qloo trending: we pulled the weekly trending series for ${tr.artists} artists (the demo artists, five equally popular peers each, and Tom Petty). It moves from ${fmtDate(tr.windows[0].firstDate)} to ${fmtDate(tr.windows[2].lastDate)}, returns nothing from March to mid-October 2025, and since then all ${tr.flatNow.series} series hold one repeated value. That value keeps the early-2025 order (rank correlation ${tr.todayKeepsDec2024Order}), so it says nothing about the last 90 days.${tr.knownWakeUp?.found ? ` Even in the moving period, Tom Petty's GTA VI trailer (Dec 5 2023) did not show: his best week came ${tr.knownWakeUp.daysFromEvent} days later, ${tr.knownWakeUp.foldVsMedian}x his median rank.` : ''} We do not use it.</p>` : ''}`;

  const rows = t.candidates.map((c) => `
    <tr>
      <td>${esc(c.title)}${c.season ? ` ${esc(c.season)}` : ''}</td>
      <td>${esc(c.signal)}</td>
      <td>${c.timing.date ? `${esc(c.timing.event)} ${fmtDate(c.timing.date)} <span class="tag ${c.timing.dateStatus}">${c.timing.dateStatus}</span>` : '—'}</td>
      <td>${c.inJudging === 'yes' ? 'Yes' : c.inJudging === 'no' ? 'No' : 'Unknown'}</td>
      <td>${c.postHoc ? 'Post-hoc check only' : c.sealed ? 'Sealed' : ''}</td>
      <td>${c.sources.length ? c.sources.map((s, i) => `<a class="srclink" href="${esc(s)}" target="_blank" rel="noopener">Source ${i + 1}</a>`).join('<br>') : 'To add'}</td>
    </tr>`).join('');
  const rr = t.rules;
  el.innerHTML = `<div class="trust">
    <p class="roles">Qloo measures the audience. Our code ranks the windows and decides. The language model drafts the letter and is the baseline in the tests. A person sends.</p>
    <section><h2>Does the Qloo ranking pick better?</h2>${backtest}</section>
    <section><h2>What we learned about Qloo's data</h2>
      <ul>
        <li>Affinity depends on the signal, not on the other artists in the request: the same artist scored inside two different candidate lists got the same value. So 3,000 artists can be scored in chunks of 50 and stay on one scale.</li>
        <li>Affinity is not popularity in disguise: across 3,000 artists and 12 titles, the median rank correlation was ${p?.medianSpearman?.toFixed(2) ?? '–'}, and each title's audience picks its own artists (bar set before the test: 0.5).</li>
        <li>We tried <code>urn:tag</code> insights to explain a match. For the GTA V audience, music-genre tags came back empty, and unfiltered tags were mostly unrelated (hobbies, endorsements). For Yellowjackets, the music genres were the broad popular ones (pop, hip hop, indie). Too generic for a letter, so the card shows ranks only. With one signal title, explainability would credit that one title, so we left it off.</li>
        <li>Paging <code>filter.popularity.min=0.9</code> returns artists most popular first but skips some of the most popular (Drake is missing), so our pool is "the first 3,000 returned", not the top 3,000.</li>
        <li>A returning series is one Qloo entity across seasons, so its audience already includes the new season. That is why series are reported apart in the backtest.</li>
        <li><code>/v2/trending</code> has held one repeated value per artist since mid-October 2025, matching its early-2025 order, so we use Wikipedia page views for "quiet" instead.</li>
        <li><code>urn:demographics</code> returns relative scores per age band and gender, not shares; we convert them against an even baseline (our assumption). The overlap varies little between artists, so it only breaks ties.</li>
      </ul>
    </section>
    <section><h2>How much Qloo we used</h2>${usage}</section>
    <section><h2>Data handling</h2>
      <p>Following Qloo's developer guide, no Qloo response data (affinity or popularity values, entity IDs, raw responses) is stored in the public repository. Responses are cached privately on the server. The browser gets ranks and percentiles only. Files under <code>seal/</code> hold hashes, counts, statistics we computed (AUC, correlations, ratios) and artist names; no per-artist Qloo value.</p>
    </section>
    <details class="sec"><summary>Sealed forecast: settled after release, not during judging</summary>${seal}${results}${timeline}</details>
    <details class="sec"><summary>How we define quiet, and why The Clash is the demo</summary>${quiet}</details>
    <details class="sec"><summary>Does Qloo add something popularity cannot? (key-day check)</summary>${premise}</details>
    <details class="sec"><summary>Rules</summary>
      <p>Pool: ${esc(t.pool.rule)} N = ${Number(t.pool.n).toLocaleString('en-US')}.</p>
      <p>Card score (since Oct 23, after the backtest): with the earlier title as the Qloo signal, rank the pool by affinity and by popularity, average the two ranks, break ties by affinity. Cards show the result as "top X%" of the pool. The agent knocks only inside the top ${100 - rr.minPercentile}% (top 50% until Oct 24; now the same bar as the artist selection rule). Since Oct 28 it also needs the audience's own top ${Math.round((rr.affinityTopShare || 0.2) * 100)}% by affinity, so popularity cannot carry a letter alone; that floor was added after review and is not part of the backtest. Until Oct 23 the card showed excess affinity, the affinity percentile among the 100 artists closest in popularity.</p>
      <p>What each window pitches for: games, the launch trailer and TV spots (in-game music is licensed long before release); films, the first trailer, estimated ${rr.trailerLead.live} days before release for live action and ${rr.trailerLead.animation} for animation (Stephen Follows' averages); series, the episodes, treated as locked within ${rr.seriesLockDays} days of the premiere. ${rr.minDays} to ${rr.maxDays} days out is the best window for trailers and launches.</p>
      <p>Order: an artist that is not quiet gets no letters. Then clearance, then timing (announced dates before estimates), then the card score, then audience overlap. At most ${rr.dailyCap} letters a day per artist. Letters mention audience overlap only at ${Math.round(rr.overlapStrong * 100)}% or more. A person can knock anyway on any skipped window; that choice is logged.</p>
    </details>
    <details class="sec"><summary>Data sources</summary><ul>${ds}</ul></details>
    <details class="sec"><summary>Candidate titles</summary>
      <div class="tablewrap"><table><tr><th>Title</th><th>Earlier title used as the Qloo signal</th><th>Window</th><th>Out during judging (${fmtDate(j.start)}–${fmtDate(j.end)})</th><th>Role</th><th>Sources</th></tr>${rows}</table></div>
    </details>
  </div>`;
}

function setTab(tab) {
  if (!['today', 'roster', 'works', 'outbox', 'trust'].includes(tab)) tab = 'today';
  ui.tab = tab;
  document.body.dataset.tab = tab;
  const nextUrl = new URL(location.href); nextUrl.searchParams.set('tab', tab); history.replaceState(null, '', nextUrl);
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  for (const name of ['today', 'roster', 'works', 'outbox', 'trust']) $(`#tab-${name}`).hidden = name !== tab;
  if (tab === 'outbox') renderOutbox();
  if (tab === 'roster') loadRoster();
  if (tab === 'works') renderWorks();
  if (tab === 'trust') { renderTrust(); if (!ui.trust) loadTrust(); }
  window.scrollTo({ top: 0 });
  $('#toast').hidden = true;
}

async function loadRoster() {
  const el = $('#tab-roster');
  if (!ui.roster) el.innerHTML = '<p class="loading">Ranking your roster for every open window…</p>';
  try { ui.roster = ui.roster || await api('/api/roster'); renderRoster(); } catch (e) { el.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}

function renderRoster() {
  const r = ui.roster;
  const status = (row) => (row.action === 'letter' ? '<span class="st go">Letter today</span>' : `<span class="st">${esc(row.reason)}</span>`);
  $('#tab-roster').innerHTML = `
    <h1 class="headline">Your roster, window by window</h1>
    <p class="what">Each open window ranks artists by the card score: the earlier title's Qloo audience rank averaged with popularity. Only quiet artists with confirmed clearance get letters. ${r.letters} letter${r.letters === 1 ? '' : 's'} today for the ${r.artists} demo artists.</p>
    <p class="pull">Without Qloo’s audience signal, ${r.withoutQloo.changed} of today’s ${r.withoutQloo.decisions} decisions would change.</p>
    <p class="quietline">Most of the ${r.withoutQloo.decisions} are settled before Qloo counts, because 4 of the 5 demo artists are not quiet. The ones that change, on popularity alone:</p>
    ${r.withoutQloo.changes.length ? `<ul class="changes">${r.withoutQloo.changes.map((c) => `<li>${esc(c.replace(': no letter with Qloo, letter on popularity alone', ''))}: <span class="src">a letter on popularity alone, none with Qloo</span></li>`).join('')}</ul>` : ''}
    <div class="windows">${r.windows.map((w) => `
      <div class="win">
        <div class="win-head"><h2>${esc(w.title)}</h2><span class="src">${esc(w.use)} ${esc(w.timing.event)} ${fmtDate(w.timing.date)}, ${esc(w.timing.dateStatus)}.${w.timing.bucket !== 'in-window' ? ` ${esc(w.timing.reason.charAt(0).toUpperCase() + w.timing.reason.slice(1))}.` : ''}</span></div>
        <table class="ros"><tr><th>Demo artist</th><th>Card score</th><th>Quiet</th><th>Today</th></tr>
        ${w.rows.map((row) => `<tr><td><button class="btn link" data-artist="${esc(row.key)}">${esc(row.name)}</button></td><td>${row.topPct ? `Top ${row.topPct}%` : '–'}</td><td>${row.quiet === true ? 'Yes' : row.quiet === false ? 'No' : 'Unknown'}</td><td>${status(row)}</td></tr>`).join('')}
        </table>
        ${w.scan && w.scan.byScore.length ? `<div class="scan"><h3>Quiet artists from the ${fmtDate(r.scan.at)} scan that fit best</h3>
          <p class="src">${r.scan.quiet} of the ${r.scan.famous} most popular artists in the pool were quiet catalogue acts. Clearance for these is not entered yet, so no letters.</p>
          <ol>${w.scan.byScore.map((x) => `<li><strong>${esc(x.name)}</strong> <span class="src">top ${x.topPct}%, No. ${num(x.affinityRank)} by ${esc(w.earlier)} fans' affinity${x.year ? `, last studio album ${esc(x.year)}` : ''}</span></li>`).join('')}</ol>
          <p class="src">By popularity alone the first five would be ${w.scan.byPop.map(esc).join(', ')}.</p></div>` : ''}
    </div>`).join('')}</div>`;
  $('#tab-roster').querySelectorAll('[data-artist]').forEach((b) => b.addEventListener('click', () => {
    ui.artist = b.dataset.artist; localSet('artist', ui.artist); ui.selected = null; ui.edits = {}; ui.songs = {}; setTab('today'); load();
  }));
}

async function loadTrust() {
  try { ui.trust = await api('/api/trust'); renderModes(); renderTrust(); } catch (e) { $('#tab-trust').innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}

async function load() {
  $('#tab-today').innerHTML = '<p class="loading">Scoring today\'s doors with Qloo… The first visit after the server wakes up can take about a minute.</p>';
  try {
    ui.data = await api(`/api/state?${viewerQuery()}`);
    ui.artist = ui.data.state.artist.key;
    const sel = $('#artist');
    if (sel) sel.innerHTML = ui.data.artists.map((a) => `<option value="${a.key}"${a.key === ui.artist ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
    renderModes();
    renderCount();
    renderToday();
    if (ui.tab === 'outbox') renderOutbox();
  } catch (e) {
    const hint = location.protocol === 'file:' ? 'Run `npm start`, then open http://localhost:3000/ instead of opening public/index.html directly.' : e.message;
    $('#tab-today').innerHTML = `<p class="error">Could not load today's doors: ${esc(hint)}</p>`;
  }
}

$('#artist')?.addEventListener('change', (e) => { ui.artist = e.target.value; localSet('artist', ui.artist); ui.selected = null; ui.edits = {}; ui.songs = {}; load(); });
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
$('#header-run')?.addEventListener('click', () => { setTab('works'); if (works().list.length) scanWorks(works().list); });
renderWorksCount();
setTab(ui.tab);
load();
