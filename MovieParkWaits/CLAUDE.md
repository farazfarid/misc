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
- Queue-Times doesn't work from the browser in practice (CORS; the public proxies failed, corsproxy.io answers 401). Three modes, same `public/` code, tried in order:
  - **Server mode**: `app.js` reads `/api/waits` from `server.js`. Preferred, history shared and all-day.
  - **Snapshot mode** (GitHub Pages, the live setup): `/api/waits` 404s, so `app.js` reads `waits.json`
    written by the GitHub Action. Same payload shape as `/api/waits`.
  - **Direct mode** (last resort): no `waits.json` either, so the browser fetches Queue-Times itself, direct
    then allorigins/codetabs, and keeps today's history in `localStorage`. Unreliable, kept as a fallback only.

## Hosting (GitHub Pages)
- URL: https://farazfarid.github.io/misc/ , served from the `gh-pages` branch (`public/` contents + `waits.json` + `.nojekyll`).
- `.github/workflows/movie-park-waits.yml` runs every ~5 min (cron) and on pushes to `movie-park-waits`:
  copies `public/` onto gh-pages, runs `scripts/snapshot.mjs` to refresh `waits.json` (with today's history),
  commits only when ride data changed. **Don't hand-edit gh-pages**, push to the app branch instead.
- Scheduled workflows only start from the repo's DEFAULT branch, so the workflow file must also exist there.
  It checks out the app from `APP_REF` (currently `movie-park-waits`). If the app moves to another branch, update `APP_REF`.
- GitHub cron is best effort: runs often start 5 to 15 min late. The page warns when `waits.json` is older than 30 min while rides are open.
- GitHub disables scheduled workflows after 60 days without repo activity; re-enable in the Actions tab if that happens.

## Commands
- `npm start` → live data on http://localhost:3000
- `npm run dev:mock` → serves the fixture, for working offline
- `npm test`

## Env vars
`PORT` (3000), `PARK_ID` (310), `POLL_SECONDS` (120), `DATA_DIR` (./data), `MOCK_FILE` (unset).

## Conventions
- Keep it dependency-free unless there's a real reason.
- Closed rides are stored as `null` in history (not 0) so sparklines show gaps.
