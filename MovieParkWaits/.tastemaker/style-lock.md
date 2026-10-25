# Style lock: MovieParkWaits

Direction: Hollywood cinema marquee, inspired by Movie Park Germany's movie theme. Fan tool: never use the park's real logo or wordmark.
Surface: app shell / data view, mobile-first. Dark only (`color-scheme: dark`).

## Color contract (checked with tastemaker check_contrast.py)
text #fbf3e6 · bg #120c10 · surface #1f161c · surface-2 #2a1e26 · border #3a2c34 · gold (primary) #ffc93c · on-gold #1a1206 · red (accent) #ff5468 · velvet #7a1424
Wait levels on surface: low #45d483 9.2:1, mid #ffc93c 11.5:1, high #ff8a3d 7.5:1, very-high #ff5468 5.7:1, muted #b8a99c 7.7:1.
Text-safe: text/bg, text/surface, gold/bg, gold/surface, on-gold on gold, red/bg, red/surface, on-gold on every level colour.
Decorative only: border on bg/surface, text/gold.

## Type
Limelight (marquee title only) · Bebas Neue (numbers, kickers, labels) · DM Sans (body). Google Fonts.

## Motifs
Marquee sign with chasing bulb ring, ride cards as tickets (stub + notches + perforation), film-strip summary, film-leader loading countdown, clapperboard "Spin the reel".
Wait labels: Walk-on (≤5), Short film (<15), Feature (<30), Blockbuster (<60), Director's cut (60+), Closed = Intermission.

## Motion
App-shell track, CSS + WAAPI, no GSAP (project is dependency-free). Staggered ticket entrance on first load only, count-up on changed waits, spin reel, spotlight on pick/alert. All gated by prefers-reduced-motion.

## Icons
Lucide paths inlined as an SVG sprite (Iconify fetch was blocked by the build container's network).
