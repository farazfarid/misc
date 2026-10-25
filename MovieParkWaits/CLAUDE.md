# MovieParkWaits

Live wait-time dashboard for **Movie Park Germany (Bottrop)** as a mobile-friendly web app.

## Stack
- Node >= 18, **zero npm dependencies**. ES modules.
- `server.js`: polls Queue-Times.com, keeps today's per-ride history, serves `public/` and `GET /api/waits`.
- `public/`: vanilla HTML/CSS/JS, no build step. Prefs (pins, alerts, sort) live in the viewer's `localStorage`.
- `test/`: `node:test` tests against `test/fixture.json` (offline, no network).

## Data source
- Queue-Times.com free API: `https://queue-times.com/parks/310/queue_times.json` (310 = Movie Park Germany).
- Shape: `{ lands: [{ name, rides: [{ id, name, is_open, wait_time, last_updated }] }], rides: [] }`.
- Their terms require visible attribution "Powered by Queue-Times.com" linking to the park page. Keep it in the footer.
- Upstream refreshes about every 5 min. Don't poll faster than `POLL_SECONDS=120` default; be a polite client.
- Queue-Times probably doesn't send CORS headers (unverified). Two modes, same `public/` code:
  - **Server mode**: `app.js` reads `/api/waits` from `server.js`. Preferred, history shared and all-day.
  - **Direct mode** (static hosting, GitHub Pages): if `/api/waits` 404s, `app.js` fetches Queue-Times
    itself, trying direct then public CORS proxies (allorigins, codetabs, corsproxy.io), remembers the one
    that worked, polls every 2 min, and keeps today's history in the viewer's `localStorage`.

## Hosting
- GitHub Pages serves the `gh-pages` branch = contents of `public/` at the root, plus `.nojekyll`.
  URL: https://farazfarid.github.io/misc/ . Redeploy by copying `public/` onto `gh-pages` again.

## Commands
- `npm start` → live data on http://localhost:3000
- `npm run dev:mock` → serves the fixture, for working offline
- `npm test`

## Env vars
`PORT` (3000), `PARK_ID` (310), `POLL_SECONDS` (120), `DATA_DIR` (./data), `MOCK_FILE` (unset).

## Conventions
- Keep it dependency-free unless there's a real reason.
- Closed rides are stored as `null` in history (not 0) so sparklines show gaps.
