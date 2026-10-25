// Writes a waits.json snapshot (same shape as the server's /api/waits) for static hosting.
// Run by .github/workflows/movie-park-waits.yml every ~5 minutes against the gh-pages checkout.
// Usage: node scripts/snapshot.mjs <path/to/waits.json>
// Exit code 0 always when a file was written; prints "changed" or "unchanged" so CI can skip empty commits.
import fs from 'node:fs/promises';
import { normalize } from '../server.js';

const PARK_ID = process.env.PARK_ID || '310';
const UPSTREAM = `https://queue-times.com/parks/${PARK_ID}/queue_times.json`;
const MOCK_FILE = process.env.MOCK_FILE;
const TZ = 'Europe/Berlin';
const out = process.argv[2];
if (!out) {
  console.error('usage: node scripts/snapshot.mjs <waits.json>');
  process.exit(2);
}

const berlinDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);

async function loadUpstream() {
  if (MOCK_FILE) return JSON.parse(await fs.readFile(MOCK_FILE, 'utf8'));
  const res = await fetch(UPSTREAM, {
    headers: { 'User-Agent': 'MovieParkWaits/1.0 (fan dashboard)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Queue-Times responded ${res.status}`);
  return res.json();
}

let previous = null;
try { previous = JSON.parse(await fs.readFile(out, 'utf8')); } catch { /* first run */ }

// Rebuild today's history from the previous snapshot; it resets at Berlin midnight.
const now = new Date();
const today = berlinDate(now);
const history = {};
if (previous?.historyDate === today) {
  for (const r of previous.rides || []) history[r.id] = r.history || [];
}

let rides = previous?.rides?.map(({ history: _h, ...r }) => r) || [];
let error = null;
let fetchedAt = previous?.fetchedAt || null;
try {
  rides = normalize(await loadUpstream());
  fetchedAt = now.toISOString();
  for (const r of rides) {
    const series = (history[r.id] ||= []);
    const value = r.isOpen ? r.wait : null;
    const last = series.at(-1);
    if (last && last[1] === value && now - new Date(last[0]) < 10 * 60 * 1000) continue;
    series.push([now.toISOString(), value]);
  }
} catch (err) {
  error = err.message;
  console.error('Upstream fetch failed:', err.message);
}

const payload = {
  park: { id: PARK_ID, name: 'Movie Park Germany', location: 'Bottrop', timezone: TZ },
  fetchedAt,
  historyDate: today,
  pollSeconds: 300,
  error,
  stale: Boolean(error) || !fetchedAt,
  source: { name: 'Queue-Times.com', url: `https://queue-times.com/parks/${PARK_ID}` },
  rides: rides.map((r) => ({ ...r, history: history[r.id] || [] })),
};

// Only ride data counts as a change; a new fetchedAt alone doesn't justify a commit.
const fingerprint = (p) => JSON.stringify((p?.rides || []).map((r) => [r.id, r.isOpen, r.wait, r.lastUpdated]).concat([p?.error ?? null]));
const changed = !previous || fingerprint(previous) !== fingerprint(payload) || previous.historyDate !== today;
await fs.writeFile(out, JSON.stringify(payload));
console.log(changed ? 'changed' : 'unchanged');
