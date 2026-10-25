// Park map: Leaflet + OpenStreetMap tiles, loaded on first use so the list view stays light.
// Ride positions come from the official attraction pages (rides-info.json).
const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist';
// Subresource integrity hashes, identical to the ones published on leafletjs.com.
const SRI_JS = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
const SRI_CSS = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
const PARK_CENTER = [51.6215, 6.9748];

let L = null;
let map = null;
let rideLayer, memberLayer, meMarker, meAccuracy;

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${LEAFLET}/leaflet.css`;
    css.integrity = SRI_CSS;
    css.crossOrigin = '';
    document.head.append(css);
    const js = document.createElement('script');
    js.src = `${LEAFLET}/leaflet.js`;
    js.integrity = SRI_JS;
    js.crossOrigin = '';
    js.onload = () => resolve(window.L);
    js.onerror = () => reject(new Error('Karte konnte nicht geladen werden'));
    document.head.append(js);
  });
}

export async function ensureMap(el) {
  if (map) {
    map.invalidateSize();
    return map;
  }
  L = await loadLeaflet();
  map = L.map(el, { zoomControl: true, attributionControl: true }).setView(PARK_CENTER, 17);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  rideLayer = L.layerGroup().addTo(map);
  memberLayer = L.layerGroup().addTo(map);
  return map;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// rides: [{ id, name, isOpen, wait, info, level, votes }]
export function updateRides(rides, onOpenRide) {
  if (!map) return;
  rideLayer.clearLayers();
  for (const r of rides) {
    if (r.info?.lat == null) continue;
    const label = r.isOpen ? (r.wait ?? '?') : '×';
    const votes = r.votes ? `<i class="pin-votes">${r.votes}</i>` : '';
    const icon = L.divIcon({
      className: '',
      html: `<span class="pin ${r.level}${r.hidden ? ' dim' : ''}">${label}${votes}</span>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });
    const m = L.marker([r.info.lat, r.info.lon], { icon, title: r.name, keyboard: true }).addTo(rideLayer);
    const wait = r.isOpen ? `${r.wait ?? '?'} min` : 'geschlossen';
    m.bindPopup(`<b>${esc(r.name)}</b><br>${wait}${r.heightText ? ` · ${esc(r.heightText)}` : ''}`);
    m.on('click', () => onOpenRide?.(r.id));
  }
}

// members: [{ id, name, loc }]
export function updateMembers(members, meId) {
  if (!map) return;
  memberLayer.clearLayers();
  for (const m of members) {
    if (!m.loc || m.id === meId) continue;
    const icon = L.divIcon({
      className: '',
      html: `<span class="buddy">${esc(m.name.slice(0, 1).toUpperCase())}</span>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
    const mins = Math.max(0, Math.round((Date.now() - m.loc.ts) / 60000));
    L.marker([m.loc.lat, m.loc.lon], { icon, title: m.name, zIndexOffset: 1000 })
      .bindPopup(`<b>${esc(m.name)}</b><br>${mins < 1 ? 'gerade eben' : `vor ${mins} Min.`}`)
      .addTo(memberLayer);
  }
}

export function updateMe(pos, center = false) {
  if (!map || !pos) return;
  const ll = [pos.lat, pos.lon];
  if (!meMarker) {
    meAccuracy = L.circle(ll, { radius: pos.acc || 20, weight: 1, color: '#4ea1ff', fillOpacity: 0.12 }).addTo(map);
    meMarker = L.circleMarker(ll, { radius: 8, weight: 3, color: '#fff', fillColor: '#4ea1ff', fillOpacity: 1 }).addTo(map);
  } else {
    meMarker.setLatLng(ll);
    meAccuracy.setLatLng(ll).setRadius(pos.acc || 20);
  }
  if (center) map.setView(ll, Math.max(map.getZoom(), 17));
}

export function focusRide(lat, lon) {
  if (map) map.setView([lat, lon], 18);
}
