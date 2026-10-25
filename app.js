// Movie Park Waits frontend: renders ride tickets from one of three sources, tried in order:
// 1. /api/waits from server.js (self-hosted)
// 2. waits.json, a snapshot a GitHub Action writes to gh-pages every ~5 min (GitHub Pages)
// 3. Queue-Times fetched from the browser (direct or via a public CORS proxy), history in localStorage
const REFRESH_MS = 60 * 1000;
const TREND_WINDOW_MS = 30 * 60 * 1000;
const PREFS_KEY = 'mpw-prefs-v1';
const HISTORY_KEY = 'mpw-history-v1';
const PROXY_KEY = 'mpw-proxy-v1';
const PARK_ID = '310';
const UPSTREAM = `https://queue-times.com/parks/${PARK_ID}/queue_times.json`;
// Last resort only. corsproxy.io was dropped: it answers 401 without an API key.
const PROXIES = [
  (u) => u,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];
const SNAPSHOT_STALE_MS = 30 * 60 * 1000;
const ALERT_OPTIONS = [5, 10, 15, 20, 30, 45];
const GROUP_KEY = 'mpw-group-v1';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

let mode = 'server'; // 'server' | 'snapshot' | 'direct', decided on first load
let data = null;
let loading = false;
let firstRender = true;
let pickedId = null; // ride chosen by "Spin the reel"
// Last wait seen per ride, so an alert fires once when crossing the threshold, not on every refresh.
const lastSeenWait = new Map();
// Last rendered wait per ride, so changed numbers can count up/down.
const renderedWait = new Map();
let rideInfo = {}; // Queue-Times id -> official info (group, heights, coordinates), from rides-info.json
let myPos = null; // { lat, lon, acc, ts } once the user allows location
let view = 'list';

const $ = (id) => document.getElementById(id);
const els = {
  rides: $('rides'), updated: $('updated'), liveDot: $('live-dot'), banner: $('banner'), refresh: $('refresh'),
  search: $('search'), sort: $('sort'), chips: $('chips'), toast: $('toast'), source: $('source'),
  open: $('s-open'), avg: $('s-avg'), long: $('s-long'), longLabel: $('s-long-label'),
  reel: $('reel'), featureTitle: $('feature-title'), featureName: $('feature-name'), featureWait: $('feature-wait'),
  spin: $('spin'), sheet: $('alert-sheet'), sheetTitle: $('sheet-title'), sheetOptions: $('sheet-options'),
  sheetRemove: $('sheet-remove'),
  views: { list: $('view-list'), map: $('view-map'), group: $('view-group') },
  tabbar: document.querySelector('.tabbar'), tabBadge: $('tab-badge'),
  mapEl: $('map'), locate: $('locate'), mapNote: $('map-note'),
  groupSetup: $('group-setup'), groupLive: $('group-live'), myName: $('my-name'), joinCode: $('join-code'),
  groupCreate: $('group-create'), groupJoin: $('group-join'), groupCode: $('group-code'), groupConn: $('group-conn'),
  groupShare: $('group-share'), groupLeave: $('group-leave'), members: $('members'), shareLoc: $('share-loc'),
  newRound: $('new-round'), voteList: $('vote-list'), voteWinner: $('vote-winner'),
};

const prefs = loadPrefs();

function loadPrefs() {
  const defaults = { favs: [], alerts: {}, sort: 'wait', filter: 'all', openOnly: false };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    // Older versions: filter 'open' meant "open only"; sort 'land' no longer exists.
    if (saved.filter === 'open') { saved.filter = 'all'; saved.openOnly = true; }
    if (saved.filter?.startsWith?.('land:')) saved.filter = 'all';
    if (saved.sort === 'land') saved.sort = 'wait';
    return { ...defaults, ...saved };
  } catch {
    return defaults;
  }
}

function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
}

// --- Direct mode (no server): same payload shape as the server's /api/waits ---

function berlinDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(d);
}

// Queue-Times names for this park carry stray zero-width spaces; they break sorting and search.
const cleanName = (name) => String(name).replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

function normalize(raw) {
  const toRide = (r, land) => ({
    id: String(r.id), name: cleanName(r.name), land, isOpen: Boolean(r.is_open),
    wait: Number.isFinite(r.wait_time) ? r.wait_time : null, lastUpdated: r.last_updated || null,
  });
  const rides = [];
  for (const land of raw.lands || []) for (const r of land.rides || []) rides.push(toRide(r, land.name));
  for (const r of raw.rides || []) rides.push(toRide(r, null));
  return rides;
}

async function fetchUpstream() {
  let preferred = 0;
  try { preferred = Number(localStorage.getItem(PROXY_KEY)) || 0; } catch { /* ignore */ }
  const order = [preferred, ...PROXIES.keys()].filter((v, i, a) => a.indexOf(v) === i);
  let lastErr;
  for (const i of order) {
    try {
      const res = await fetch(PROXIES[i](UPSTREAM), { cache: 'no-store', signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      if (!Array.isArray(raw.lands) && !Array.isArray(raw.rides)) throw new Error('unexpected response');
      try { localStorage.setItem(PROXY_KEY, String(i)); } catch { /* ignore */ }
      return raw;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('no source reachable');
}

function loadHistory() {
  try {
    const h = JSON.parse(localStorage.getItem(HISTORY_KEY) || 'null');
    if (h && h.date === berlinDate()) return h;
  } catch { /* ignore */ }
  return { date: berlinDate(), rides: {} };
}

function recordHistory(rides) {
  const h = loadHistory();
  const now = new Date();
  for (const r of rides) {
    const series = (h.rides[r.id] ||= []);
    const value = r.isOpen ? r.wait : null;
    const last = series.at(-1);
    if (last && last[1] === value && now - new Date(last[0]) < 10 * 60 * 1000) continue;
    series.push([now.toISOString(), value]);
  }
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch { /* ignore */ }
  return h;
}

async function loadDirect() {
  try {
    const rides = normalize(await fetchUpstream());
    const h = recordHistory(rides);
    return {
      fetchedAt: new Date().toISOString(), error: null, stale: false,
      source: { name: 'Queue-Times.com', url: `https://queue-times.com/parks/${PARK_ID}` },
      rides: rides.map((r) => ({ ...r, history: h.rides[r.id] || [] })),
    };
  } catch (err) {
    if (!data) throw err;
    return { ...data, error: err.message, stale: true }; // keep showing the last good data
  }
}

async function loadFromServer() {
  const res = await fetch('api/waits', { cache: 'no-store' });
  const isJson = (res.headers.get('content-type') || '').includes('json');
  if (res.status === 404 || res.status === 405 || (res.ok && !isJson)) {
    try {
      const snap = await loadSnapshot();
      mode = 'snapshot';
      return snap;
    } catch {
      mode = 'direct';
      return loadDirect();
    }
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadSnapshot() {
  // Query string busts GitHub Pages' 10 minute cache.
  const res = await fetch(`waits.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const snap = await res.json();
  if (!Array.isArray(snap.rides)) throw new Error('unexpected snapshot');
  for (const r of snap.rides) r.name = cleanName(r.name);
  return snap;
}

async function loadAny() {
  if (mode === 'direct') return loadDirect();
  if (mode === 'snapshot') {
    try { return await loadSnapshot(); } catch (err) {
      if (!data) throw err;
      return { ...data, error: err.message, stale: true };
    }
  }
  return loadFromServer();
}

// --- Presentation helpers ---

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;

// Colour band plus a movie-length label for each wait.
function rating(ride) {
  if (!ride.isOpen) return { cls: 'closed', label: 'Geschlossen' };
  const w = ride.wait ?? 0;
  if (w <= 5) return { cls: 'low', label: 'Walk-on' };
  if (w < 15) return { cls: 'low', label: 'Short film' };
  if (w < 30) return { cls: 'mid', label: 'Feature' };
  if (w < 60) return { cls: 'high', label: 'Blockbuster' };
  return { cls: 'very-high', label: "Director's cut" };
}

function relTime(iso) {
  if (!iso) return 'nie';
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'gerade eben';
  if (mins < 60) return `vor ${mins} Min.`;
  return `von ${new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))} Uhr`;
}

// Compare the current wait with the reading roughly TREND_WINDOW_MS ago.
function trend(ride) {
  if (!ride.isOpen || ride.wait == null) return null;
  const cutoff = Date.now() - TREND_WINDOW_MS;
  const past = [...ride.history].reverse().find(([t, w]) => new Date(t) <= cutoff && w != null);
  if (!past) return null;
  const diff = ride.wait - past[1];
  if (Math.abs(diff) < 5) return { cls: 'flat', label: '→ stabil' };
  return diff > 0 ? { cls: 'up', label: `↑ ${diff} min` } : { cls: 'down', label: `↓ ${-diff} min` };
}

function sparkline(history) {
  const pts = history.filter(([, w]) => w != null);
  if (pts.length < 2) return '';
  const W = 84, H = 22, pad = 2;
  const t0 = new Date(history[0][0]).getTime();
  const t1 = Math.max(new Date(history.at(-1)[0]).getTime(), t0 + 1);
  const max = Math.max(15, ...pts.map(([, w]) => w));
  let d = '';
  let penDown = false;
  for (const [t, w] of history) {
    if (w == null) { penDown = false; continue; } // gap while the ride was closed
    const x = pad + ((new Date(t) - t0) / (t1 - t0)) * (W - 2 * pad);
    const y = H - pad - (w / max) * (H - 2 * pad);
    d += `${penDown ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    penDown = true;
  }
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}"/></svg>`;
}

const GROUP_LABEL = { kids: 'Kinder-Ride', family: 'Familie', thrill: 'Thrill', horror: 'Halloween-Horror' };
const metres = (cm) => `${(cm / 100).toFixed(2).replace('.', ',')} m`;

function heightText(info) {
  if (!info || info.minCm == null) return '';
  const parts = [info.minCm > 0 ? `ab ${metres(info.minCm)}` : 'ohne Mindestgröße'];
  if (info.maxCm && info.maxCm < 190) parts.push(`max. ${metres(info.maxCm)}`);
  return parts.join(' · ');
}

// Straight-line distance in metres.
function distance(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function rideDistance(ride) {
  const info = rideInfo[ride.id];
  if (!myPos || info?.lat == null) return null;
  return distance(myPos, info);
}

const fmtDistance = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);

// --- Filtering ---

const FILTERS = [
  ['all', 'Alle'],
  ['no-kids', 'Ohne Kinder-Rides'],
  ['kids', 'Nur Kinder-Rides'],
  ['thrill', 'Thrill'],
  ['horror', 'Horror'],
  ['pinned', 'Gemerkt'],
];

function matchesFilter(ride) {
  if (prefs.openOnly && !ride.isOpen) return false;
  const group = rideInfo[ride.id]?.group;
  switch (prefs.filter) {
    case 'no-kids': return group !== 'kids';
    case 'kids': return group === 'kids';
    case 'thrill': return group === 'thrill';
    case 'horror': return group === 'horror';
    case 'pinned': return prefs.favs.includes(ride.id);
    default: return true;
  }
}

const openRides = () => (data?.rides || []).filter((r) => r.isOpen && r.wait != null);
// Open rides that pass the current filter: what Spin and the vote list choose from.
const candidateRides = () => openRides().filter(matchesFilter);

// --- Rendering ---

function sortRides(rides) {
  const byName = (a, b) => a.name.localeCompare(b.name, 'de');
  // Closed rides always sink to the bottom when sorting by wait.
  const waitKey = (r) => (r.isOpen && r.wait != null ? r.wait : Infinity);
  const distKey = (r) => rideDistance(r) ?? Infinity;
  const cmp = {
    wait: (a, b) => waitKey(a) - waitKey(b) || byName(a, b),
    'wait-desc': (a, b) => (b.isOpen - a.isOpen) || (b.wait ?? -1) - (a.wait ?? -1) || byName(a, b),
    name: byName,
    distance: (a, b) => (b.isOpen - a.isOpen) || distKey(a) - distKey(b) || byName(a, b),
  }[prefs.sort] || ((a, b) => waitKey(a) - waitKey(b));
  return [...rides].sort(cmp);
}

function ticket(ride) {
  const r = rating(ride);
  const info = rideInfo[ride.id];
  const fav = prefs.favs.includes(ride.id);
  const alertAt = prefs.alerts[ride.id];
  const tr = trend(ride);
  const name = escapeHtml(ride.name);
  const dist = rideDistance(ride);
  const stub = ride.isOpen
    ? `<span class="stub-wait" data-wait="${ride.wait ?? ''}">${ride.wait ?? '?'}</span><span class="stub-unit">MIN</span>`
    : '<span class="stub-wait">Intermission</span>';
  const tags = [
    info?.group && GROUP_LABEL[info.group] ? `<span class="tag tag-${info.group}">${GROUP_LABEL[info.group]}</span>` : '',
    heightText(info) ? `<span class="tag" title="${escapeHtml(info.rule || '')}">${heightText(info)}</span>` : '',
    dist != null ? `<span class="tag tag-dist">${fmtDistance(dist)}</span>` : '',
  ].join('');
  return `
    <article class="ticket ${r.cls}" data-id="${escapeHtml(ride.id)}">
      <div class="stub">${stub}<span class="stub-rating">${r.label}</span></div>
      <div class="ticket-body">
        <h3 class="ticket-name">${name}</h3>
        ${tags ? `<p class="ticket-tags">${tags}</p>` : ''}
        <div class="ticket-meta">
          ${sparkline(ride.history)}
          ${tr ? `<span class="trend ${tr.cls}">${tr.label}</span>` : ''}
          ${alertAt != null ? `<span class="alert-tag">${icon('bell').replace('class="icon"', 'class="icon" style="width:14px;height:14px"')} ≤ ${alertAt}</span>` : ''}
        </div>
        <div class="ticket-actions">
          <button type="button" data-action="fav" aria-pressed="${fav}" aria-label="${name} merken">${icon('star')}</button>
          <button type="button" data-action="alert" aria-pressed="${alertAt != null}" aria-label="Wartezeit-Alarm für ${name}">${icon('bell')}</button>
        </div>
      </div>
    </article>`;
}

function renderChips() {
  if (!FILTERS.some(([v]) => v === prefs.filter)) prefs.filter = 'all';
  els.chips.innerHTML =
    `<button type="button" class="chip chip-toggle" data-toggle="open" aria-pressed="${prefs.openOnly}">${icon('check')}Nur offene</button>` +
    FILTERS.map(([v, label]) => `<button type="button" class="chip" data-filter="${v}" aria-pressed="${v === prefs.filter}">${label}</button>`).join('');
}

function render() {
  if (!data) return;
  renderChips();
  const q = els.search.value.trim().toLowerCase();
  const rides = sortRides(data.rides.filter((r) => matchesFilter(r) && (!q || r.name.toLowerCase().includes(q))));

  const favs = prefs.filter === 'pinned' ? [] : rides.filter((r) => prefs.favs.includes(r.id));
  const rest = rides.filter((r) => !favs.includes(r));
  let html = '';
  if (favs.length) html += '<h2 class="group-title">Gemerkt</h2>' + favs.map(ticket).join('');
  if (favs.length && rest.length) html += '<h2 class="group-title">Alle weiteren</h2>';
  html += rest.map(ticket).join('');
  if (!rides.length) html = emptyState();
  els.rides.innerHTML = html;

  animateTickets();
  renderSummary();
  renderFeature();
  renderMap();
  renderGroup();
}

function emptyState() {
  if (!data.rides.length) return '<p class="empty"><b>Noch keine Rollen</b>Warte auf die ersten Wartezeiten.</p>';
  if (prefs.filter === 'pinned') return '<p class="empty"><b>Noch nichts gemerkt</b>Tippe auf den Stern bei einer Attraktion.</p>';
  return '<p class="empty"><b>Cut!</b>Keine Attraktion passt zu Suche und Filter.</p>';
}

function animateTickets() {
  const tickets = [...els.rides.querySelectorAll('.ticket')];
  if (firstRender && !reducedMotion.matches) {
    // One staggered entrance on first load only; refreshes stay calm.
    tickets.forEach((el, i) => el.animate(
      [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
      { duration: 320, delay: Math.min(i, 12) * 40, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' },
    ));
  }
  for (const el of tickets) {
    const num = el.querySelector('.stub-wait[data-wait]');
    const id = el.dataset.id;
    const to = num ? Number(num.dataset.wait) : null;
    const from = renderedWait.get(id);
    renderedWait.set(id, to);
    if (firstRender || num == null || from == null || from === to || !Number.isFinite(to)) continue;
    countTo(num, from, to);
    num.classList.add('flip');
  }
  firstRender = false;
}

function countTo(el, from, to) {
  if (reducedMotion.matches) { el.textContent = to; return; }
  const start = performance.now();
  const dur = 700;
  const step = (now) => {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderSummary() {
  const open = openRides();
  els.open.textContent = `${open.length}/${data.rides.length}`;
  els.avg.textContent = open.length ? `${Math.round(open.reduce((s, r) => s + r.wait, 0) / open.length)}′` : '–';
  const longest = [...open].sort((a, b) => b.wait - a.wait)[0];
  els.long.textContent = longest ? `${longest.wait}′` : '–';
  els.longLabel.textContent = longest ? longest.name : 'längste Schlange';
  els.longLabel.title = longest ? `Längste Schlange: ${longest.name}` : '';
}

function renderFeature() {
  if (spinning) return;
  const pool = candidateRides();
  let ride = pickedId && pool.find((r) => r.id === pickedId);
  if (!ride) pickedId = null;
  ride ||= [...pool].sort((a, b) => a.wait - b.wait || a.name.localeCompare(b.name, 'de'))[0];
  els.featureTitle.textContent = pickedId ? 'Dein nächster Ride' : 'Kürzeste Schlange gerade';
  els.featureName.textContent = ride ? ride.name : (openRides().length ? 'Nichts Offenes in diesem Filter' : 'Alles geschlossen');
  els.featureWait.textContent = ride ? ride.wait : '–';
  els.spin.disabled = pool.length < 2;
}

// How old the park's numbers are: Queue-Times' newest per-ride timestamp, not when we last fetched.
function dataTime() {
  const stamps = data.rides.map((r) => r.lastUpdated).filter(Boolean).sort();
  return stamps.at(-1) || data.fetchedAt;
}

function renderStatus() {
  if (!data) return;
  els.updated.textContent = `Live · Parkdaten ${relTime(dataTime())}`;
  els.liveDot.classList.toggle('stale', Boolean(data.stale));
  let msg = '';
  if (data.error && data.fetchedAt) msg = `Queue-Times gerade nicht erreichbar (${data.error}). Angezeigt: Stand ${relTime(data.fetchedAt)}.`;
  else if (data.error) msg = `Queue-Times gerade nicht erreichbar (${data.error}).`;
  else if (mode === 'snapshot' && data.rides.some((r) => r.isOpen) && Date.now() - new Date(dataTime()) > SNAPSHOT_STALE_MS) msg = `Achtung: Diese Zeiten sind ${relTime(dataTime())}. Das nächste Update sollte in wenigen Minuten kommen.`;
  else if (data.rides.length && !data.rides.some((r) => r.isOpen)) msg = 'Licht aus: Gerade ist alles geschlossen. Schau während der Öffnungszeiten wieder rein.';
  els.banner.hidden = !msg;
  els.banner.textContent = msg;
}

// --- Spin the reel ---

let spinning = false;

function weightedPick(rides) {
  // Shorter queues are much more likely, but anything open can come up.
  const weights = rides.map((r) => 1 / (r.wait + 5));
  let x = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < rides.length; i++) if ((x -= weights[i]) <= 0) return rides[i];
  return rides.at(-1);
}

async function spin() {
  const pool = candidateRides();
  if (spinning || pool.length < 2) return;
  const winner = weightedPick(pool.filter((r) => r.id !== pickedId));
  spinning = true;
  els.spin.disabled = true;
  els.spin.classList.remove('snap');
  void els.spin.offsetWidth; // restart the clapper snap
  els.spin.classList.add('snap');
  els.featureTitle.textContent = 'Rolling…';

  if (!reducedMotion.matches) {
    els.featureName.classList.add('rolling');
    for (let i = 0; i < 16; i++) {
      const r = pool[(Math.random() * pool.length) | 0];
      els.featureName.textContent = r.name;
      els.featureWait.textContent = r.wait;
      await new Promise((res) => setTimeout(res, 45 + i * i * 1.1));
    }
    els.featureName.classList.remove('rolling');
  }

  spinning = false;
  pickedId = winner.id;
  renderFeature();
  els.reel.classList.remove('spotlight');
  void els.reel.offsetWidth;
  els.reel.classList.add('spotlight');
  spotlightTicket(winner.id, false);
}

function spotlightTicket(id, scroll = true) {
  const el = els.rides.querySelector(`.ticket[data-id="${CSS.escape(id)}"]`);
  if (!el) return;
  if (scroll) el.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'center' });
  el.classList.remove('spotlit');
  void el.offsetWidth;
  el.classList.add('spotlit');
}

// --- Alerts ---

let sheetRideId = null;

function openAlertSheet(ride) {
  sheetRideId = ride.id;
  const current = prefs.alerts[ride.id];
  els.sheetTitle.textContent = ride.name;
  els.sheetOptions.innerHTML = ALERT_OPTIONS
    .map((n) => `<button type="submit" value="${n}" aria-pressed="${current === n}">${n}<small>min</small></button>`)
    .join('');
  els.sheetRemove.hidden = current == null;
  els.sheet.showModal();
}

els.sheet.addEventListener('close', async () => {
  const value = els.sheet.returnValue;
  els.sheet.returnValue = '';
  if (!sheetRideId || !value || value === 'cancel') return;
  if (value === 'remove') {
    delete prefs.alerts[sheetRideId];
  } else {
    prefs.alerts[sheetRideId] = Number(value);
    lastSeenWait.delete(sheetRideId); // re-evaluate now
    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch { /* ignored */ }
    }
  }
  savePrefs();
  render();
  checkAlerts();
});

function checkAlerts() {
  for (const ride of data.rides) {
    const threshold = prefs.alerts[ride.id];
    const prev = lastSeenWait.get(ride.id);
    const now = ride.isOpen ? ride.wait : null;
    lastSeenWait.set(ride.id, now);
    if (threshold == null || now == null || now > threshold) continue;
    // Fire on the first reading at/below threshold, or when crossing down into it.
    if (prev == null || prev > threshold) {
      notify(`${ride.name}: ${now} min`, `Unter deinem Alarm von ${threshold} min.`);
      spotlightTicket(ride.id, false);
    }
  }
}

function notify(title, body) {
  showToast(title);
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: 'icon.svg', tag: title }); } catch { /* some mobile browsers need a service worker */ }
  }
}

let toastTimer;
function showToast(text, iconName = 'bell') {
  els.toast.innerHTML = `${icon(iconName)}<span>${escapeHtml(text)}</span>`;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 6000);
}

// --- Views ---

function setView(next) {
  view = next;
  for (const [name, el] of Object.entries(els.views)) el.hidden = name !== next;
  for (const b of els.tabbar.querySelectorAll('button')) {
    if (b.dataset.view === next) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  if (next === 'map') openMap();
  if (next === 'group') renderGroup();
  window.scrollTo({ top: 0 });
}

// --- Location ---

let watchId = null;
let centerOnNextFix = false;

function startLocation(center = false) {
  centerOnNextFix ||= center;
  if (watchId != null) {
    if (center && myPos) { mapModule?.updateMe(myPos, true); centerOnNextFix = false; }
    return;
  }
  if (!('geolocation' in navigator)) { showToast('Dein Browser kann keinen Standort liefern', 'locate'); return; }
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      myPos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, ts: Date.now() };
      mapModule?.updateMe(myPos, centerOnNextFix);
      centerOnNextFix = false;
      maybeShareLocation();
      if (view === 'list') render();
    },
    (err) => {
      watchId = null;
      const msg = err.code === 1 ? 'Standort nicht erlaubt. In den Browser-Einstellungen freigeben.' : 'Standort gerade nicht verfügbar.';
      showToast(msg, 'locate');
      if (els.shareLoc.checked) { els.shareLoc.checked = false; group?.stopLocation(); }
    },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 },
  );
}

// --- Map ---

let mapModule = null;

async function openMap() {
  try {
    mapModule ||= await import('./map.js');
    await mapModule.ensureMap(els.mapEl);
    renderMap();
    if (myPos) mapModule.updateMe(myPos);
  } catch (err) {
    els.mapNote.textContent = `${err.message}. Prüfe die Internetverbindung.`;
  }
}

function renderMap() {
  if (!mapModule || !data) return;
  const tally = group ? group.tally() : new Map();
  mapModule.updateRides(data.rides.map((r) => ({
    id: r.id, name: r.name, isOpen: r.isOpen, wait: r.wait,
    info: rideInfo[r.id], level: rating(r).cls, heightText: heightText(rideInfo[r.id]),
    votes: tally.get(r.id)?.length || 0, hidden: !matchesFilter(r),
  })));
  if (group) mapModule.updateMembers(group.activeMembers(), group.me.id);
}

// --- Group: shared votes and locations ---

let group = null;
let groupModule = null;
let lastSharedPos = null;

function loadGroupPrefs() {
  try { return JSON.parse(localStorage.getItem(GROUP_KEY) || '{}'); } catch { return {}; }
}

function saveGroupPrefs(p) {
  try { localStorage.setItem(GROUP_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

function myIdentity() {
  const p = loadGroupPrefs();
  if (!p.id) p.id = crypto.getRandomValues(new Uint32Array(2)).join('-');
  p.name = (els.myName.value.trim() || p.name || '').slice(0, 20);
  saveGroupPrefs(p);
  return p;
}

async function joinGroup(code) {
  groupModule ||= await import('./group.js');
  const clean = groupModule.normalizeCode(code);
  if (clean.length < 6) { showToast('Der Gruppencode ist zu kurz', 'users'); return; }
  const me = myIdentity();
  if (!me.name) { els.myName.focus(); showToast('Bitte zuerst deinen Namen eintragen', 'users'); return; }
  group?.stop();
  group = new groupModule.GroupSync({
    code: clean,
    me: { id: me.id, name: me.name },
    onChange: () => scheduleGroupRender(),
    onError: (err) => showToast(err.message, 'users'),
  });
  saveGroupPrefs({ ...me, code: clean });
  history.replaceState(null, '', `#g=${clean}`);
  try {
    await group.start();
  } catch (err) {
    showToast(`Gruppe konnte nicht starten: ${err.message}`, 'users');
  }
  renderGroup();
}

async function leaveGroup() {
  const p = loadGroupPrefs();
  delete p.code;
  saveGroupPrefs(p);
  els.shareLoc.checked = false;
  await group?.leave();
  group = null;
  history.replaceState(null, '', location.pathname + location.search);
  renderGroup();
  renderMap();
}

let groupRenderQueued = false;
function scheduleGroupRender() {
  if (groupRenderQueued) return;
  groupRenderQueued = true;
  requestAnimationFrame(() => { groupRenderQueued = false; renderGroup(); renderMap(); });
}

function renderGroup() {
  const live = Boolean(group);
  els.groupSetup.hidden = live;
  els.groupLive.hidden = !live;
  const tally = live ? group.tally() : new Map();
  const totalVotes = [...tally.values()].reduce((n, v) => n + v.length, 0);
  els.tabBadge.hidden = !live || !totalVotes;
  els.tabBadge.textContent = totalVotes || '';
  if (!live) return;

  els.groupCode.textContent = group.code;
  els.groupConn.textContent = group.connected ? '· verbunden' : '· verbinde…';
  els.groupConn.classList.toggle('ok', group.connected);

  els.members.innerHTML = group.activeMembers()
    .sort((a, b) => (a.id === group.me.id ? -1 : b.id === group.me.id ? 1 : a.name.localeCompare(b.name, 'de')))
    .map((m) => {
      const where = m.loc
        ? (myPos && m.id !== group.me.id ? fmtDistance(distance(myPos, m.loc)) : 'Standort geteilt')
        : '';
      return `<span class="member${m.id === group.me.id ? ' me' : ''}"><b>${escapeHtml(m.name)}</b>${where ? `<small>${where}</small>` : ''}</span>`;
    }).join('');

  if (!data) return;
  const mine = new Set(group.myVotes());
  // Rides with votes stay visible even if someone else's filter differs from yours.
  const pool = new Map(candidateRides().map((r) => [r.id, r]));
  for (const id of tally.keys()) {
    const r = data.rides.find((x) => x.id === id);
    if (r) pool.set(id, r);
  }
  const rows = [...pool.values()].sort((a, b) =>
    (tally.get(b.id)?.length || 0) - (tally.get(a.id)?.length || 0) || waitOf(a) - waitOf(b) || a.name.localeCompare(b.name, 'de'));

  const top = rows[0] && tally.get(rows[0].id)?.length ? rows[0] : null;
  els.voteWinner.hidden = !top;
  if (top) {
    const n = tally.get(top.id).length;
    els.voteWinner.innerHTML = `<p class="feature-label">Gruppen-Favorit</p><p class="vote-winner-name">${escapeHtml(top.name)}</p>
      <p class="vote-winner-meta">${n} ${n === 1 ? 'Stimme' : 'Stimmen'} · ${top.isOpen ? `${top.wait} min warten` : 'gerade geschlossen'}</p>`;
  }

  els.voteList.innerHTML = rows.map((r) => {
    const voters = tally.get(r.id) || [];
    const lvl = rating(r).cls;
    return `<button type="button" class="vote-row ${lvl}" data-vote="${escapeHtml(r.id)}" aria-pressed="${mine.has(r.id)}">
      <span class="vote-wait">${r.isOpen ? r.wait : '×'}</span>
      <span class="vote-name">${escapeHtml(r.name)}${voters.length ? `<small>${voters.map(escapeHtml).join(', ')}</small>` : ''}</span>
      <span class="vote-count">${voters.length || ''}</span>
      <span class="vote-check">${icon('check')}</span>
    </button>`;
  }).join('') || '<p class="empty">Gerade ist nichts Passendes offen.</p>';
}

const waitOf = (r) => (r.isOpen && r.wait != null ? r.wait : 999);

function toggleVote(id) {
  const mine = group.myVotes();
  let next;
  if (mine.includes(id)) next = mine.filter((x) => x !== id);
  else if (mine.length >= groupModule.MAX_VOTES) { showToast(`Maximal ${groupModule.MAX_VOTES} Stimmen. Nimm erst eine zurück.`, 'users'); return; }
  else next = [...mine, id];
  group.vote(next);
}

// Share at most every 90 s, and only after moving 25 m, plus a refresh every 5 minutes.
// Keeps us well inside ntfy.sh's free rate limits.
function maybeShareLocation(force = false) {
  if (!group || !els.shareLoc.checked || !myPos) return;
  const now = Date.now();
  if (!force && lastSharedPos) {
    const moved = distance(lastSharedPos, myPos);
    const age = now - lastSharedPos.ts;
    if (!((moved >= 25 && age >= 90 * 1000) || age >= 5 * 60 * 1000)) return;
  }
  lastSharedPos = { ...myPos, ts: now };
  group.shareLocation(myPos);
}

async function shareInvite() {
  const url = `${location.origin}${location.pathname}#g=${group.code}`;
  const text = `Komm in unsere Movie-Park-Gruppe: Code ${group.code}`;
  try {
    if (navigator.share) { await navigator.share({ title: 'Movie Park Waits', text, url }); return; }
  } catch { /* user cancelled */ return; }
  try {
    await navigator.clipboard.writeText(url);
    showToast('Einladungslink kopiert', 'share');
  } catch {
    showToast(`Code: ${group.code}`, 'share');
  }
}

// --- Loading ---

let leaderTimer = setInterval(() => {
  const n = els.rides.querySelector('.leader span');
  if (!n) { clearInterval(leaderTimer); return; }
  n.textContent = n.textContent === '1' ? '3' : String(Number(n.textContent) - 1);
}, 1000);

async function loadRideInfo() {
  try {
    const res = await fetch('rides-info.json', { cache: 'no-cache' });
    if (res.ok) rideInfo = (await res.json()).rides || {};
  } catch { /* tags and map pins just stay empty */ }
}

async function load() {
  if (loading) return;
  loading = true;
  els.refresh.classList.add('spinning');
  try {
    data = await loadAny();
    if (data.source?.url) els.source.href = data.source.url;
    render();
    renderStatus();
    checkAlerts();
  } catch (err) {
    els.banner.hidden = false;
    els.banner.textContent = `Wartezeiten konnten nicht geladen werden (${err.message}). Neuer Versuch läuft…`;
  } finally {
    loading = false;
    els.refresh.classList.remove('spinning');
  }
}

// --- Events ---

els.rides.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.closest('.ticket').dataset.id;
  const ride = data.rides.find((r) => r.id === id);
  if (btn.dataset.action === 'fav') {
    prefs.favs = prefs.favs.includes(id) ? prefs.favs.filter((f) => f !== id) : [...prefs.favs, id];
    savePrefs();
    render();
  } else {
    openAlertSheet(ride);
  }
});

els.chips.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  if (chip.dataset.toggle === 'open') prefs.openOnly = !prefs.openOnly;
  else prefs.filter = chip.dataset.filter;
  savePrefs();
  render();
});

els.tabbar.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (b) setView(b.dataset.view);
});

els.search.addEventListener('input', render);
els.sort.value = prefs.sort;
els.sort.addEventListener('change', () => {
  prefs.sort = els.sort.value;
  savePrefs();
  if (prefs.sort === 'distance') startLocation();
  render();
});
els.spin.addEventListener('click', spin);
els.refresh.addEventListener('click', load);
els.locate.addEventListener('click', () => startLocation(true));

els.groupCreate.addEventListener('click', async () => {
  groupModule ||= await import('./group.js');
  joinGroup(groupModule.newGroupCode());
});
els.groupJoin.addEventListener('click', () => joinGroup(els.joinCode.value));
els.joinCode.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGroup(els.joinCode.value); });
els.groupLeave.addEventListener('click', leaveGroup);
els.groupShare.addEventListener('click', shareInvite);
els.newRound.addEventListener('click', () => group?.newRound());
els.voteList.addEventListener('click', (e) => {
  const b = e.target.closest('[data-vote]');
  if (b && group) toggleVote(b.dataset.vote);
});
els.shareLoc.addEventListener('change', () => {
  if (els.shareLoc.checked) {
    startLocation();
    maybeShareLocation(true);
    showToast('Dein Standort wird mit der Gruppe geteilt', 'locate');
  } else {
    lastSharedPos = null;
    group?.stopLocation();
  }
});

document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

// Direct mode hits Queue-Times per viewer, so poll every other tick (2 min) there.
// Snapshot mode re-reads waits.json every minute; it changes at most every ~5 min.
let tick = 0;
setInterval(() => { tick++; if (!document.hidden && (mode !== 'direct' || tick % 2 === 0)) load(); }, REFRESH_MS);
setInterval(renderStatus, 30 * 1000);

// Restore name and group (invite links carry #g=<code>).
{
  const p = loadGroupPrefs();
  if (p.name) els.myName.value = p.name;
  const fromLink = new URLSearchParams(location.hash.slice(1)).get('g');
  if (fromLink) {
    els.joinCode.value = fromLink;
    setView('group');
    if (p.name) joinGroup(fromLink);
  } else if (p.code && p.name) {
    joinGroup(p.code);
  }
}

loadRideInfo().then(load);
