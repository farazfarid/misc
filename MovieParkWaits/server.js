// Movie Park Waits: tiny zero-dependency server.
// - Polls Queue-Times.com for Movie Park Germany wait times on a fixed interval
// - Keeps today's per-ride history (in memory + data/history.json) for trends
// - Serves the static frontend from public/ and a normalized JSON API
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

const PORT = Number(process.env.PORT || 3000);
const PARK_ID = process.env.PARK_ID || '310'; // Queue-Times id for Movie Park Germany
const UPSTREAM = `https://queue-times.com/parks/${PARK_ID}/queue_times.json`;
// Queue-Times refreshes roughly every 5 minutes; polling faster gains nothing.
const POLL_MS = Number(process.env.POLL_SECONDS || 120) * 1000;
// For offline development/tests: read upstream JSON from a file instead of the network.
const MOCK_FILE = process.env.MOCK_FILE;
const TZ = 'Europe/Berlin';

const state = {
  snapshot: null, // last successful normalized ride list
  fetchedAt: null, // ISO time of last successful upstream fetch
  lastError: null, // message of the last failed fetch, cleared on success
  history: { date: berlinDate(), rides: {} }, // rides: { [id]: [[isoTime, waitOrNull], ...] }
};

function berlinDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); // YYYY-MM-DD
}

async function loadUpstream() {
  if (MOCK_FILE) return JSON.parse(await fs.readFile(MOCK_FILE, 'utf8'));
  const res = await fetch(UPSTREAM, {
    headers: { 'User-Agent': 'MovieParkWaits/1.0 (personal dashboard)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Queue-Times responded ${res.status}`);
  return res.json();
}

// Queue-Times groups rides into "lands"; parks without lands use a flat "rides" array.
export function normalize(raw) {
  const rides = [];
  for (const land of raw.lands || []) {
    for (const r of land.rides || []) rides.push(toRide(r, land.name));
  }
  for (const r of raw.rides || []) rides.push(toRide(r, null));
  return rides;
}

function toRide(r, land) {
  return {
    id: String(r.id),
    // Queue-Times names for this park carry stray zero-width spaces; they break sorting and search.
    name: String(r.name).replace(/[\u200B-\u200D\uFEFF]/g, '').trim(),
    land,
    isOpen: Boolean(r.is_open),
    wait: Number.isFinite(r.wait_time) ? r.wait_time : null,
    lastUpdated: r.last_updated || null,
  };
}

function recordHistory(rides, now = new Date()) {
  const today = berlinDate(now);
  if (state.history.date !== today) state.history = { date: today, rides: {} };
  const t = now.toISOString();
  for (const r of rides) {
    const series = (state.history.rides[r.id] ||= []);
    const value = r.isOpen ? r.wait : null;
    const last = series.at(-1);
    // Skip if nothing changed within the last 10 minutes, keeps the file small.
    if (last && last[1] === value && now - new Date(last[0]) < 10 * 60 * 1000) continue;
    series.push([t, value]);
  }
}

async function loadHistory() {
  try {
    const saved = JSON.parse(await fs.readFile(HISTORY_FILE, 'utf8'));
    if (saved.date === berlinDate()) state.history = saved;
  } catch {
    // No history yet, or unreadable: start fresh.
  }
}

async function saveHistory() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(HISTORY_FILE, JSON.stringify(state.history));
  } catch (err) {
    console.warn('Could not persist history:', err.message);
  }
}

async function poll() {
  try {
    const rides = normalize(await loadUpstream());
    state.snapshot = rides;
    state.fetchedAt = new Date().toISOString();
    state.lastError = null;
    recordHistory(rides);
    await saveHistory();
  } catch (err) {
    state.lastError = err.message;
    console.warn('Upstream fetch failed:', err.message);
  }
}

function apiPayload() {
  const rides = (state.snapshot || []).map((r) => ({
    ...r,
    history: state.history.rides[r.id] || [],
  }));
  return {
    park: { id: PARK_ID, name: 'Movie Park Germany', location: 'Bottrop', timezone: TZ },
    fetchedAt: state.fetchedAt,
    pollSeconds: POLL_MS / 1000,
    error: state.lastError,
    stale: Boolean(state.lastError) || !state.fetchedAt,
    source: { name: 'Queue-Times.com', url: `https://queue-times.com/parks/${PARK_ID}` },
    rides,
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}

export function createServer() {
  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname === '/api/waits') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(apiPayload()));
      return;
    }
    if (pathname === '/healthz') {
      res.writeHead(state.fetchedAt ? 200 : 503, { 'Content-Type': 'text/plain' });
      res.end(state.fetchedAt ? 'ok' : 'no data yet');
      return;
    }
    serveStatic(req, res);
  });
}

export async function start() {
  await loadHistory();
  await poll();
  const timer = setInterval(poll, POLL_MS);
  const server = createServer();
  server.on('close', () => clearInterval(timer));
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`Movie Park Waits on http://localhost:${server.address().port} (source: ${MOCK_FILE || UPSTREAM})`);
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) start();
