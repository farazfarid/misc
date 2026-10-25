# MEMORY: MovieParkWaits

## 2026-10-25: initial build
**Done**
- Node server (no deps) polling Queue-Times park 310 every 2 min, normalizing lands/rides, persisting today's history to `data/history.json` (reset at Berlin midnight).
- Frontend: ride cards color-coded by wait (<15 green, <30 yellow, <60 orange, 60+ red), today's sparkline, 30-min trend arrow, park summary (open count, avg, shortest), search, sort (wait/name/area), open-only toggle, pin rides, per-ride "alert me at ≤ N min" (in-page toast + browser Notification), auto-refresh every 60 s, stale/closed-park banners, light/dark, PWA manifest.
- Tests: 4 `node:test` tests pass. UI checked with Playwright on desktop + 390 px phone against the fixture, no console errors, no horizontal scroll. Alert flow verified.

**Not verified**
- **Never run against the live Queue-Times API**: the build container's network blocked queue-times.com. Park id 310 is confirmed via queue-times.com URLs found by web search, and the response shape is from their public API docs. First thing to do on a real machine: `npm start`, open the page, check rides show up.
- Ride names/areas in `test/fixture.json` are illustrative; real land grouping from Queue-Times may differ.
- Browser notifications on iOS only work when the app is added to the home screen (and may need a service worker, none exists yet).

**Open / ideas**
- Deploy somewhere always-on (Render/Railway/Fly/a small VPS) so history accumulates all day. Serverless (Vercel) would lose the in-memory polling/history.
- Service worker for offline shell + reliable mobile notifications.
- Park opening hours (Queue-Times doesn't provide them in this endpoint).
- "Best time to ride" from multi-day history.

## 2026-10-25: GitHub Pages hosting
- Added direct mode to `public/app.js` (see CLAUDE.md "Data source"), so the static page works without the server.
- Tested in Playwright with upstream faked: direct OK, direct blocked → allorigins fallback, all sources failing → banner. Server mode unchanged, tests pass.
- Deployed `public/` to the `gh-pages` branch. Pages has to be switched on once in repo Settings → Pages → Deploy from branch `gh-pages` / root.
- **Risk**: direct mode depends on Queue-Times allowing CORS or on free third-party proxies, which can rate-limit or vanish. A proper fix is a tiny own proxy (e.g. a Cloudflare Worker) set as the first entry in `PROXIES`.
- Not verified against live Queue-Times from this container (network blocked).
