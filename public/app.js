// Sleeper Hit front end. Plain modules, no build step.
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
    : 'Past film and game sequels: ahead of popularity; 23 sequel artists in the top 50 to the LLM’s 16 (difference +7, interval 0 to +16).';
  return `<div><dt>Qloo says</dt><dd>${esc(d.window.earlier.label)} fans: No. ${num(b.affinityRank)} of ${num(b.of)} artists by affinity. No. ${num(b.popularityRank)} by popularity.</dd></div>
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

  const skips = skip.length ? `
    <div class="skipped">
      <h3>${door ? 'Not pitching today' : 'Open windows, and why not today'}</h3>
      <div class="skips">${skip.map((d) => `
        <div class="skip">
          <strong>${esc(titleOf(d.window))}</strong>
          <p>${esc(allUnconfirmed ? 'Clearance unconfirmed.' : d.reason)}</p>
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

function addToOutbox(door) {
  const text = ui.edits[door.id] ?? ui.data.letters[door.id]?.text ?? '';
  const today = ui.data.state.today;
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

function renderCount() {
  const open = outbox().filter((l) => l.status !== 'sent').length;
  $('#outbox-count').textContent = open ? String(open) : '';
}

const OUTCOMES = [['unknown', 'No reply yet'], ['passed', 'Passed'], ['hold', 'On hold'], ['quote', 'Quote requested'], ['placed', 'Placed']];

function renderOutbox() {
  const el = $('#tab-outbox');
  const note = '<p class="note-store">Saved in this browser only. Nothing is emailed, and the server keeps no copy.</p>';
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
          : `<button class="btn primary" data-send>Copy and mark sent</button><button class="btn quiet" data-remove>Remove</button>`}
      </div>
      <div class="sub">${l.deadline ? `Window date ${fmtDate(l.deadline)}${l.deadline.length === 10 ? `, ${days(l.deadline)} days left` : ''}` : ''}</div>
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
    row.querySelector('[data-send]')?.addEventListener('click', async () => {
      const text = row.querySelector('[data-text]').value;
      try { await navigator.clipboard.writeText(text); } catch { /* clipboard may be blocked */ }
      patch({ status: 'sent', sentAt: new Date().toISOString(), text }, 'Copied. Marked as sent.');
    });
    row.querySelector('[data-remove]')?.addEventListener('click', () => { saveOutbox(outbox().filter((x) => x.id !== id)); renderCount(); renderOutbox(); });
    row.querySelector('[data-used]')?.addEventListener('change', (e) => patch({ used: e.target.value }, 'Saved.'));
    row.querySelector('[data-text]')?.addEventListener('change', (e) => patch({ text: e.target.value }, 'Letter saved.'));
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
    const rows = [['qlooBlend', 'Qloo card score'], ['llm', 'LLM only'], ['similarTitles', 'What similar titles used'], ['popularity', 'Popularity']];
    const max = Math.max(...rows.map(([k]) => ov.hits[k].value));
    return `<div class="bars" role="img" aria-label="Sequel artists found in the top 50">${rows.map(([k, label]) => `<div class="barrow${k === 'qlooBlend' ? ' lead' : ''}"><span class="barlabel">${label}</span><span class="bartrack"><span class="barfill" style="width:${(ov.hits[k].value / max) * 100}%"></span></span><span class="barval">${n0(ov.hits[k].value)} <span class="of">of ${b.positives}</span></span></div>`).join('')}</div>`;
  })() : '';
  const usesTable = b ? `<table><tr><th>Qloo use (registered before the test)</th><th>AUC over popularity</th><th>Top-50 hits over the LLM</th><th>Cleared the bar</th></tr>${['qlooRaw', 'qlooExcess', 'qlooTimesPop', 'qlooBlend'].map((k) => { const v = ov.qlooVs[k]; return `<tr><td>${esc(names[k])}</td><td>${ci(v.aucMinusPopularity)}</td><td>${ci(v.hitsMinusLlm, sgn0)}</td><td>${h1[k]?.holds ? '<strong>Yes</strong>' : 'No'}</td></tr>`; }).join('')}</table>` : '';
  const backtest = b ? `
    <p class="claim">On ${b.pairsScored} sequels already out, the earlier title's Qloo audience rank, averaged with popularity, put the artists each sequel went on to use higher than popularity alone or an LLM did. Audience rank alone pointed the same way but did not clear our bar.</p>
<p class="story">One of 12 sequels where the card score found an artist that neither popularity nor the LLM did: the soundtrack of <em>Guardians of the Galaxy Vol. 2</em> includes Fleetwood Mac, and ranked from the first film's Qloo audience, Fleetwood Mac was in our top 50 of about 3,000 artists. Qloo's data is today's, so fans of the first film have also seen Vol. 2. That bias favours Qloo; the sealed forecast is the clean test.</p>
    <p class="sub">Sequel artists found in each method's top 50, summed over ${b.pairsScored} sequels (${b.positives} to find).</p>
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
      <p>Card score (since Oct 23, after the backtest): with the earlier title as the Qloo signal, rank the pool by affinity and by popularity, average the two ranks, break ties by affinity. Cards show the result as "top X%" of the pool. The agent knocks only inside the top ${100 - rr.minPercentile}% (top 50% until Oct 24; now the same bar as the artist selection rule). Until Oct 23 the card showed excess affinity, the affinity percentile among the 100 artists closest in popularity.</p>
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
  ui.tab = tab;
  const nextUrl = new URL(location.href); nextUrl.searchParams.set('tab', tab); history.replaceState(null, '', nextUrl);
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  for (const name of ['today', 'roster', 'outbox', 'trust', 'works']) $(`#tab-${name}`).hidden = name !== tab;
  if (tab === 'works' || tab === 'roster') window.dispatchEvent(new CustomEvent('portfolio-tab', { detail: tab }));
  if (tab === 'outbox' && ui.data) renderOutbox();
  if (tab === 'roster') loadRoster();
  if (tab === 'trust') { renderTrust(); if (!ui.trust) loadTrust(); }
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
    <p class="quietline">Without Qloo's audience signal (popularity alone), ${r.withoutQloo.changed} of ${r.withoutQloo.decisions} decisions today would change${r.withoutQloo.changes.length ? `: ${r.withoutQloo.changes.map(esc).join('; ')}` : ''}.</p>
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
    </div>`).join('')}</div><div id="roster-opportunities"></div>`;
  $('#tab-roster').querySelectorAll('[data-artist]').forEach((b) => b.addEventListener('click', () => {
    ui.artist = b.dataset.artist; localSet('artist', ui.artist); ui.selected = null; ui.edits = {}; ui.songs = {}; setTab('today'); load();
  }));
  window.dispatchEvent(new CustomEvent('roster-ready'));
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
    window.dispatchEvent(new CustomEvent('today-ready'));
    if (ui.tab === 'outbox') renderOutbox();
  } catch (e) {
    const hint = location.protocol === 'file:' ? 'Run `npm start`, then open http://localhost:3000/ instead of opening public/index.html directly.' : e.message;
    $('#tab-today').innerHTML = `<p class="error">Could not load today's doors: ${esc(hint)}</p>`;
  }
}

window.addEventListener('portfolio-refresh', () => {
  ui.roster = null;
  load();
});

$('#artist')?.addEventListener('change', (e) => { ui.artist = e.target.value; localSet('artist', ui.artist); ui.selected = null; ui.edits = {}; ui.songs = {}; load(); });
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
setTab(ui.tab);
load();

const accountButton = $('#account');
const accountMenu = $('#account-menu');
if (accountButton && accountMenu) { $('#account-email').textContent = localGet('accountEmail') || 'you@example.com'; accountButton.addEventListener('click', () => { const open = accountMenu.hidden; accountMenu.hidden = !open; accountButton.setAttribute('aria-expanded', String(open)); }); document.addEventListener('click', (event) => { if (!event.target.closest('.account-control')) { accountMenu.hidden = true; accountButton.setAttribute('aria-expanded', 'false'); } }); }
$('#header-run')?.addEventListener('click', async () => { const button = $('#header-run'); button.disabled = true; button.textContent = 'Running…'; try { const response = await fetch(`${API_BASE}/api/portfolio/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }); if (!response.ok) throw Error('Could not update opportunities'); window.dispatchEvent(new CustomEvent('portfolio-refresh')); toast('New opportunities and match scores updated'); } catch (error) { toast(error.message); } finally { button.disabled = false; button.textContent = 'Run'; } });
$('#header-gear')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('schedule-settings')));
