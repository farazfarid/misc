// Movie Park Waits frontend: polls /api/waits and renders ride tickets.
// Without the Node server (static hosting like GitHub Pages) it falls back to
// fetching Queue-Times from the browser and keeps today's history in localStorage.
const REFRESH_MS = 60 * 1000;
const TREND_WINDOW_MS = 30 * 60 * 1000;
const PREFS_KEY = 'mpw-prefs-v1';
const HISTORY_KEY = 'mpw-history-v1';
const PROXY_KEY = 'mpw-proxy-v1';
const PARK_ID = '310';
const UPSTREAM = `https://queue-times.com/parks/${PARK_ID}/queue_times.json`;
// Queue-Times may not send CORS headers, so try direct first, then public CORS proxies.
const PROXIES = [
  (u) => u,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];
const ALERT_OPTIONS = [5, 10, 15, 20, 30, 45];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

let mode = 'server'; // switches to 'direct' once /api/waits turns out not to exist
let data = null;
let loading = false;
let firstRender = true;
let pickedId = null; // ride chosen by "Spin the reel"
// Last wait seen per ride, so an alert fires once when crossing the threshold, not on every refresh.
const lastSeenWait = new Map();
// Last rendered wait per ride, so changed numbers can count up/down.
const renderedWait = new Map();

const $ = (id) => document.getElementById(id);
const els = {
  rides: $('rides'), updated: $('updated'), liveDot: $('live-dot'), banner: $('banner'), refresh: $('refresh'),
  search: $('search'), sort: $('sort'), chips: $('chips'), toast: $('toast'), source: $('source'),
  open: $('s-open'), avg: $('s-avg'), long: $('s-long'), longLabel: $('s-long-label'),
  reel: $('reel'), featureTitle: $('feature-title'), featureName: $('feature-name'), featureWait: $('feature-wait'),
  spin: $('spin'), sheet: $('alert-sheet'), sheetTitle: $('sheet-title'), sheetOptions: $('sheet-options'),
  sheetRemove: $('sheet-remove'),
};

const prefs = loadPrefs();

function loadPrefs() {
  const defaults = { favs: [], alerts: {}, sort: 'wait', filter: 'all' };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    if (saved.openOnly && !saved.filter) saved.filter = 'open'; // pre-redesign pref
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

function normalize(raw) {
  const toRide = (r, land) => ({
    id: String(r.id), name: r.name, land, isOpen: Boolean(r.is_open),
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
    mode = 'direct';
    return loadDirect();
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// --- Presentation helpers ---

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;

// Colour band plus a movie-length label for each wait.
function rating(ride) {
  if (!ride.isOpen) return { cls: 'closed', label: 'Closed' };
  const w = ride.wait ?? 0;
  if (w <= 5) return { cls: 'low', label: 'Walk-on' };
  if (w < 15) return { cls: 'low', label: 'Short film' };
  if (w < 30) return { cls: 'mid', label: 'Feature' };
  if (w < 60) return { cls: 'high', label: 'Blockbuster' };
  return { cls: 'very-high', label: "Director's cut" };
}

function relTime(iso) {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

// Compare the current wait with the reading roughly TREND_WINDOW_MS ago.
function trend(ride) {
  if (!ride.isOpen || ride.wait == null) return null;
  const cutoff = Date.now() - TREND_WINDOW_MS;
  const past = [...ride.history].reverse().find(([t, w]) => new Date(t) <= cutoff && w != null);
  if (!past) return null;
  const diff = ride.wait - past[1];
  if (Math.abs(diff) < 5) return { cls: 'flat', label: '→ steady' };
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

const openRides = () => (data?.rides || []).filter((r) => r.isOpen && r.wait != null);

// --- Rendering ---

function sortRides(rides) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  // Closed rides always sink to the bottom when sorting by wait.
  const waitKey = (r) => (r.isOpen && r.wait != null ? r.wait : Infinity);
  const cmp = {
    wait: (a, b) => waitKey(a) - waitKey(b) || byName(a, b),
    'wait-desc': (a, b) => (b.isOpen - a.isOpen) || (b.wait ?? -1) - (a.wait ?? -1) || byName(a, b),
    name: byName,
    land: (a, b) => (a.land || '').localeCompare(b.land || '') || byName(a, b),
  }[prefs.sort] || ((a, b) => waitKey(a) - waitKey(b));
  return [...rides].sort(cmp);
}

function ticket(ride) {
  const r = rating(ride);
  const fav = prefs.favs.includes(ride.id);
  const alertAt = prefs.alerts[ride.id];
  const tr = trend(ride);
  const name = escapeHtml(ride.name);
  const stub = ride.isOpen
    ? `<span class="stub-wait" data-wait="${ride.wait ?? ''}">${ride.wait ?? '?'}</span><span class="stub-unit">MIN</span>`
    : '<span class="stub-wait">Intermission</span>';
  return `
    <article class="ticket ${r.cls}" data-id="${escapeHtml(ride.id)}">
      <div class="stub">${stub}<span class="stub-rating">${r.label}</span></div>
      <div class="ticket-body">
        <h3 class="ticket-name">${name}</h3>
        ${ride.land ? `<p class="ticket-land">${escapeHtml(ride.land)}</p>` : ''}
        <div class="ticket-meta">
          ${sparkline(ride.history)}
          ${tr ? `<span class="trend ${tr.cls}">${tr.label}</span>` : ''}
          ${alertAt != null ? `<span class="alert-tag">${icon('bell').replace('class="icon"', 'class="icon" style="width:14px;height:14px"')} ≤ ${alertAt}</span>` : ''}
        </div>
        <div class="ticket-actions">
          <button type="button" data-action="fav" aria-pressed="${fav}" aria-label="Pin ${name}">${icon('star')}</button>
          <button type="button" data-action="alert" aria-pressed="${alertAt != null}" aria-label="Wait alert for ${name}">${icon('bell')}</button>
        </div>
      </div>
    </article>`;
}

function renderChips() {
  const lands = [...new Set((data?.rides || []).map((r) => r.land).filter(Boolean))].sort();
  const chips = [['all', 'All rides'], ['open', 'Open now'], ['pinned', 'Pinned'], ...lands.map((l) => [`land:${l}`, l])];
  if (!chips.some(([v]) => v === prefs.filter)) prefs.filter = 'all';
  els.chips.innerHTML = chips
    .map(([v, label]) => `<button type="button" class="chip" data-filter="${escapeHtml(v)}" aria-pressed="${v === prefs.filter}">${escapeHtml(label)}</button>`)
    .join('');
}

function applyFilter(rides) {
  const f = prefs.filter;
  if (f === 'open') return rides.filter((r) => r.isOpen);
  if (f === 'pinned') return rides.filter((r) => prefs.favs.includes(r.id));
  if (f.startsWith('land:')) return rides.filter((r) => r.land === f.slice(5));
  return rides;
}

function render() {
  if (!data) return;
  renderChips();
  const q = els.search.value.trim().toLowerCase();
  const rides = sortRides(applyFilter(data.rides.filter((r) => !q || r.name.toLowerCase().includes(q))));

  const favs = prefs.filter === 'pinned' ? [] : rides.filter((r) => prefs.favs.includes(r.id));
  const rest = rides.filter((r) => !favs.includes(r));
  let html = '';
  if (favs.length) html += '<h2 class="group-title">Your picks</h2>' + favs.map(ticket).join('');
  if (prefs.sort === 'land') {
    let current;
    for (const r of rest) {
      if (r.land !== current) {
        current = r.land;
        html += `<h2 class="group-title">${escapeHtml(current || 'Other')}</h2>`;
      }
      html += ticket(r);
    }
  } else {
    if (favs.length && rest.length) html += '<h2 class="group-title">Full program</h2>';
    html += rest.map(ticket).join('');
  }
  if (!rides.length) html = emptyState();
  els.rides.innerHTML = html;

  animateTickets();
  renderSummary();
  renderFeature();
}

function emptyState() {
  if (!data.rides.length) return '<p class="empty"><b>No reels yet</b>Waiting for the first wait times to arrive.</p>';
  if (prefs.filter === 'pinned') return '<p class="empty"><b>No picks yet</b>Tap the star on a ride to pin it here.</p>';
  return '<p class="empty"><b>Cut!</b>No ride matches that search.</p>';
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
  els.longLabel.textContent = longest ? longest.name : 'longest line';
  els.longLabel.title = longest ? `Longest line: ${longest.name}` : '';
}

function renderFeature() {
  if (spinning) return;
  const open = openRides();
  let ride = pickedId && open.find((r) => r.id === pickedId);
  if (!ride) pickedId = null;
  ride ||= [...open].sort((a, b) => a.wait - b.wait || a.name.localeCompare(b.name))[0];
  els.featureTitle.textContent = pickedId ? 'Your next ride' : 'Shortest line right now';
  els.featureName.textContent = ride ? ride.name : 'All rides are closed';
  els.featureWait.textContent = ride ? ride.wait : '–';
  els.spin.disabled = open.length < 2;
}

function renderStatus() {
  if (!data) return;
  els.updated.textContent = `Live · updated ${relTime(data.fetchedAt)}`;
  els.liveDot.classList.toggle('stale', Boolean(data.stale));
  let msg = '';
  if (data.error && data.fetchedAt) msg = `Can't reach Queue-Times right now (${data.error}). Showing the last reel from ${relTime(data.fetchedAt)}.`;
  else if (data.error) msg = `Can't reach Queue-Times right now (${data.error}).`;
  else if (data.rides.length && !data.rides.some((r) => r.isOpen)) msg = 'The lights are down: every ride is closed right now. Check back during opening hours.';
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
  const open = openRides();
  if (spinning || open.length < 2) return;
  const pool = open.filter((r) => r.id !== pickedId);
  const winner = weightedPick(pool);
  spinning = true;
  els.spin.disabled = true;
  els.spin.classList.remove('snap');
  void els.spin.offsetWidth; // restart the clapper snap
  els.spin.classList.add('snap');
  els.featureTitle.textContent = 'Rolling…';

  if (!reducedMotion.matches) {
    els.featureName.classList.add('rolling');
    const steps = 16;
    for (let i = 0; i < steps; i++) {
      const r = open[(Math.random() * open.length) | 0];
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
      notify(`${ride.name}: ${now} min`, `At or below your ${threshold} min alert.`);
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
function showToast(text) {
  els.toast.innerHTML = `${icon('bell')}<span>${escapeHtml(text)}</span>`;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 6000);
}

// --- Loading ---

let leaderTimer = setInterval(() => {
  const n = els.rides.querySelector('.leader span');
  if (!n) { clearInterval(leaderTimer); return; }
  n.textContent = n.textContent === '1' ? '3' : String(Number(n.textContent) - 1);
}, 1000);

async function load() {
  if (loading) return;
  loading = true;
  els.refresh.classList.add('spinning');
  try {
    data = mode === 'direct' ? await loadDirect() : await loadFromServer();
    if (data.source?.url) els.source.href = data.source.url;
    render();
    renderStatus();
    checkAlerts();
  } catch (err) {
    els.banner.hidden = false;
    els.banner.textContent = `Can't load wait times (${err.message}). Retrying…`;
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
  prefs.filter = chip.dataset.filter;
  savePrefs();
  render();
});

els.search.addEventListener('input', render);
els.sort.value = prefs.sort;
els.sort.addEventListener('change', () => { prefs.sort = els.sort.value; savePrefs(); render(); });
els.spin.addEventListener('click', spin);
els.refresh.addEventListener('click', load);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

// Direct mode hits Queue-Times per viewer, so poll every other tick (2 min) there.
let tick = 0;
setInterval(() => { tick++; if (!document.hidden && (mode === 'server' || tick % 2 === 0)) load(); }, REFRESH_MS);
setInterval(renderStatus, 30 * 1000);
load();
