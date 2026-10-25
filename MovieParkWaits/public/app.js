// Movie Park Waits frontend: polls /api/waits and renders ride cards.
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
let mode = 'server'; // switches to 'direct' once /api/waits turns out not to exist

const $ = (id) => document.getElementById(id);
const els = {
  rides: $('rides'), updated: $('updated'), banner: $('banner'), refresh: $('refresh'),
  search: $('search'), sort: $('sort'), openOnly: $('open-only'), toast: $('toast'), source: $('source'),
  open: $('s-open'), avg: $('s-avg'), short: $('s-short'), shortLabel: $('s-short-label'),
};

const prefs = loadPrefs();
let data = null;
let loading = false;
// Last wait seen per ride, so an alert fires once when crossing the threshold, not on every refresh.
const lastSeenWait = new Map();

function loadPrefs() {
  const defaults = { favs: [], alerts: {}, sort: 'wait', openOnly: false };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return defaults;
  }
}

function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function level(ride) {
  if (!ride.isOpen) return 'closed';
  if (ride.wait == null || ride.wait < 15) return 'low';
  if (ride.wait < 30) return 'mid';
  if (ride.wait < 60) return 'high';
  return 'very-high';
}

function relTime(iso) {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
  const W = 90, H = 22, pad = 2;
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

function sortRides(rides) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  // Closed rides always sink to the bottom when sorting by wait.
  const waitKey = (r) => (r.isOpen && r.wait != null ? r.wait : Infinity);
  const cmp = {
    wait: (a, b) => waitKey(a) - waitKey(b) || byName(a, b),
    'wait-desc': (a, b) => (b.isOpen - a.isOpen) || (b.wait ?? -1) - (a.wait ?? -1) || byName(a, b),
    name: byName,
    land: (a, b) => (a.land || '').localeCompare(b.land || '') || byName(a, b),
  }[prefs.sort];
  return [...rides].sort(cmp);
}

function rideCard(ride) {
  const lvl = level(ride);
  const fav = prefs.favs.includes(ride.id);
  const alertAt = prefs.alerts[ride.id];
  const tr = trend(ride);
  const waitHtml = ride.isOpen
    ? `<b>${ride.wait ?? '?'}</b><small>min</small>`
    : '<b>Closed</b>';
  return `
    <article class="ride ${lvl}" data-id="${escapeHtml(ride.id)}">
      <div class="wait">${waitHtml}</div>
      <div class="name">${escapeHtml(ride.name)}</div>
      <div class="meta">
        ${sparkline(ride.history)}
        ${tr ? `<span class="trend ${tr.cls}">${tr.label}</span>` : ''}
        ${alertAt != null ? `<span class="alert-tag">alert ≤ ${alertAt}</span>` : ''}
      </div>
      <div class="actions">
        <button type="button" data-action="fav" aria-pressed="${fav}" aria-label="Pin ${escapeHtml(ride.name)}" title="Pin to top">★</button>
        <button type="button" data-action="alert" aria-pressed="${alertAt != null}" aria-label="Wait alert for ${escapeHtml(ride.name)}" title="Alert when the wait drops">🔔</button>
      </div>
    </article>`;
}

function render() {
  if (!data) return;
  const q = els.search.value.trim().toLowerCase();
  let rides = data.rides.filter((r) => !q || r.name.toLowerCase().includes(q));
  if (prefs.openOnly) rides = rides.filter((r) => r.isOpen);
  rides = sortRides(rides);

  const favs = rides.filter((r) => prefs.favs.includes(r.id));
  const rest = rides.filter((r) => !prefs.favs.includes(r.id));
  let html = '';
  if (favs.length) html += '<h2 class="group-title">Pinned</h2>' + favs.map(rideCard).join('');
  if (prefs.sort === 'land') {
    let current;
    for (const r of rest) {
      if (r.land !== current) {
        current = r.land;
        html += `<h2 class="group-title">${escapeHtml(current || 'Other')}</h2>`;
      }
      html += rideCard(r);
    }
  } else {
    if (favs.length && rest.length) html += '<h2 class="group-title">All rides</h2>';
    html += rest.map(rideCard).join('');
  }
  if (!rides.length) {
    html = `<p class="empty">${data.rides.length ? 'No rides match.' : 'No ride data yet.'}</p>`;
  }
  els.rides.innerHTML = html;
  renderSummary();
}

function renderSummary() {
  const open = data.rides.filter((r) => r.isOpen && r.wait != null);
  els.open.textContent = `${open.length}/${data.rides.length}`;
  els.avg.textContent = open.length ? `${Math.round(open.reduce((s, r) => s + r.wait, 0) / open.length)} min` : '–';
  const shortest = [...open].sort((a, b) => a.wait - b.wait)[0];
  els.short.textContent = shortest ? `${shortest.wait} min` : '–';
  els.shortLabel.textContent = shortest ? shortest.name : 'shortest';
  els.shortLabel.title = shortest ? shortest.name : '';
}

function renderStatus() {
  if (!data) return;
  els.updated.textContent = `updated ${relTime(data.fetchedAt)}`;
  let msg = '';
  if (data.error && data.fetchedAt) msg = `Can't reach Queue-Times right now (${data.error}). Showing data from ${relTime(data.fetchedAt)}.`;
  else if (data.error) msg = `Can't reach Queue-Times right now (${data.error}).`;
  else if (data.rides.length && !data.rides.some((r) => r.isOpen)) msg = 'All rides are closed. The park is probably closed right now.';
  els.banner.hidden = !msg;
  els.banner.textContent = msg;
}

function checkAlerts() {
  for (const ride of data.rides) {
    const threshold = prefs.alerts[ride.id];
    const prev = lastSeenWait.get(ride.id);
    const now = ride.isOpen ? ride.wait : null;
    lastSeenWait.set(ride.id, now);
    if (threshold == null || now == null || now > threshold) continue;
    // Fire on the first reading at/below threshold, or when crossing down into it.
    if (prev === undefined || prev == null || prev > threshold) {
      notify(`${ride.name}: ${now} min wait`, `At or below your ${threshold} min alert.`);
    }
  }
}

function notify(title, body) {
  showToast(`🔔 ${title}`);
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: 'icon.svg', tag: title }); } catch { /* some mobile browsers need a service worker */ }
  }
}

let toastTimer;
function showToast(text) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 6000);
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

els.rides.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.closest('.ride').dataset.id;
  const ride = data.rides.find((r) => r.id === id);
  if (btn.dataset.action === 'fav') {
    prefs.favs = prefs.favs.includes(id) ? prefs.favs.filter((f) => f !== id) : [...prefs.favs, id];
  } else {
    const current = prefs.alerts[id];
    const answer = prompt(
      `Alert me when "${ride.name}" is at or below how many minutes?\n(Leave empty to remove the alert.)`,
      current ?? 15,
    );
    if (answer === null) return;
    const n = parseInt(answer, 10);
    if (Number.isFinite(n) && n >= 0) {
      prefs.alerts[id] = n;
      lastSeenWait.delete(id); // re-evaluate on next refresh
      if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
      }
    } else {
      delete prefs.alerts[id];
    }
  }
  savePrefs();
  render();
  if (btn.dataset.action === 'alert') checkAlerts();
});

els.search.addEventListener('input', render);
els.sort.value = prefs.sort;
els.sort.addEventListener('change', () => { prefs.sort = els.sort.value; savePrefs(); render(); });
els.openOnly.checked = prefs.openOnly;
els.openOnly.addEventListener('change', () => { prefs.openOnly = els.openOnly.checked; savePrefs(); render(); });
els.refresh.addEventListener('click', load);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

// Direct mode hits Queue-Times per viewer, so poll every other tick (2 min) there.
let tick = 0;
setInterval(() => { tick++; if (!document.hidden && (mode === 'server' || tick % 2 === 0)) load(); }, REFRESH_MS);
setInterval(renderStatus, 30 * 1000);
load();
