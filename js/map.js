// Mapa Leaflet con tiles CARTO, cargado solo cuando se necesita.
// F18 racimos · F16 mini-tarjeta · F17 vuela a la más barata cerca · F4 proyección para el vuelo.

// Leaflet 1.9.4 auto-hospedado (sin CDN externo): así el shell entra en el service
// worker y la integridad no depende de un tercero.
const LEAFLET_JS = './js/vendor/leaflet/leaflet.js';
const LEAFLET_CSS = './js/vendor/leaflet/leaflet.css';

const TILES_LIGHT = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILES_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

const TENERIFE_BOUNDS = [[27.98, -16.95], [28.62, -16.10]];

let leafletReady = null;
let map = null;
let pinLayer = null;
let userMarker = null;
let miniCard = null;
let pinMarkers = {};
let prevClustered = false;
let A = null;          // últimos args {stations, priceOf, qClassOf, fmtPrice, onSelect, miniHTML}
let lastPos = null;    // última posición conocida (para F17)
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function loadLeaflet() {
  if (leafletReady) return leafletReady;
  leafletReady = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = LEAFLET_CSS;
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = LEAFLET_JS;
    js.onload = () => resolve(window.L);
    js.onerror = () => { leafletReady = null; reject(new Error('No se pudo cargar el mapa')); };
    document.head.appendChild(js);
  });
  return leafletReady;
}

export async function showMap(args) {
  const L = await loadLeaflet();
  A = args;
  if (args.pos) lastPos = args.pos;
  const container = document.getElementById('map');
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  if (!map) {
    map = L.map(container, { zoomControl: false, attributionControl: true });
    if (location.hostname === 'localhost') window.__map = map;
    L.tileLayer(dark ? TILES_DARK : TILES_LIGHT, { attribution: ATTRIB, maxZoom: 18 }).addTo(map);
    map.fitBounds(TENERIFE_BOUNDS, { padding: [10, 10] });
    map.on('zoomend moveend', () => updatePins());
    map.on('click', closeMini);
    map.on('zoomend', () => container.classList.toggle('zoomed-out', map.getZoom() < 11));
    container.classList.toggle('zoomed-out', map.getZoom() < 11);
  }

  updatePins(args);

  if (args.pos) {
    const icon = L.divIcon({ className: 'pin-wrap', html: '<div class="user-dot"></div>', iconSize: [0, 0] });
    if (userMarker) userMarker.setLatLng([args.pos.lat, args.pos.lng]);
    else userMarker = L.marker([args.pos.lat, args.pos.lng], { icon, zIndexOffset: 500, interactive: false }).addTo(map);
  }

  // el contenedor estaba oculto: recalcular tamaño
  requestAnimationFrame(() => map.invalidateSize());
}

// F18 · clustering propio por rejilla según zoom
function clusterStations(z, args) {
  const { stations, priceOf, qClassOf } = args;
  const avail = stations.filter((s) => priceOf(s) != null);
  if (z >= 12) return avail.map((s) => ({ single: s, price: priceOf(s), q: qClassOf(priceOf(s)) }));
  const cell = z >= 11 ? 0.02 : z >= 10 ? 0.04 : 0.08;
  const buckets = new Map();
  for (const s of avail) {
    const key = `${Math.round(s.lat / cell)}_${Math.round(s.lng / cell)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(s);
  }
  const out = [];
  for (const arr of buckets.values()) {
    if (arr.length === 1) { const p = priceOf(arr[0]); out.push({ single: arr[0], price: p, q: qClassOf(p) }); }
    else {
      const min = Math.min(...arr.map(priceOf));
      const lat = arr.reduce((a, s) => a + s.lat, 0) / arr.length;
      const lng = arr.reduce((a, s) => a + s.lng, 0) / arr.length;
      out.push({ cluster: arr, count: arr.length, lat, lng, price: min, q: qClassOf(min) });
    }
  }
  return out;
}

export function updatePins(args) {
  if (!map || !window.L) return;
  if (args) A = args; else args = A;
  if (!args) return;
  const L = window.L;
  const { fmtPrice } = args;
  if (pinLayer) pinLayer.remove();
  pinLayer = L.layerGroup();
  pinMarkers = {};
  const z = map.getZoom();
  const items = clusterStations(z, args);
  const blooming = prevClustered && z >= 12; // acaba de abrirse un racimo
  let bi = 0;
  for (const it of items) {
    if (it.cluster) {
      const icon = L.divIcon({ className: 'pin-wrap', html: `<div class="cluster ${it.q}">${it.count}</div>`, iconSize: [0, 0] });
      L.marker([it.lat, it.lng], { icon }).on('click', () => map.flyTo([it.lat, it.lng], z + 2, { duration: 0.6 })).addTo(pinLayer);
    } else {
      const s = it.single;
      const cls = `pin ${it.q}${blooming ? ' from-cluster' : ''}`;
      const icon = L.divIcon({ className: 'pin-wrap', html: `<div class="${cls}" style="animation-delay:${blooming ? (bi++ % 8) * 50 : 0}ms">${fmtPrice(it.price)}</div>`, iconSize: [0, 0] });
      // en racimos, el pin más barato queda siempre encima
      const mk = L.marker([s.lat, s.lng], { icon, zIndexOffset: Math.round((2.5 - it.price) * 1000) })
        .on('click', () => openMini(s)).addTo(pinLayer);
      pinMarkers[s.id] = mk;
    }
  }
  pinLayer.addTo(map);
  prevClustered = items.some((i) => i.cluster);
}

// F16 · mini-tarjeta que brota del pin (su HTML lo construye app.js, con sus helpers)
function openMini(s) {
  if (!A || !map) return;
  closeMini();
  const pt = map.latLngToContainerPoint([s.lat, s.lng]);
  const mapEl = document.getElementById('map');
  miniCard = document.createElement('div');
  miniCard.className = 'mini-card';
  miniCard.innerHTML = A.miniHTML ? A.miniHTML(s) : '';
  mapEl.appendChild(miniCard);
  const w = 230;
  let left = pt.x - w / 2;
  left = Math.max(8, Math.min(mapEl.clientWidth - w - 8, left));
  miniCard.style.left = left + 'px';
  miniCard.style.top = (pt.y - miniCard.offsetHeight - 18) + 'px';
  const mk = pinMarkers[s.id];
  const pinEl = mk && mk.getElement() && mk.getElement().querySelector('.pin');
  if (pinEl) pinEl.classList.add('is-picked');
  const verBtn = miniCard.querySelector('[data-mini-sheet]');
  if (verBtn) verBtn.addEventListener('click', () => { closeMini(); if (A.onSelect) A.onSelect(s); });
}

export function closeMini() {
  document.querySelectorAll('.pin.is-picked').forEach((p) => p.classList.remove('is-picked'));
  if (!miniCard) return;
  const m = miniCard; miniCard = null;
  m.classList.add('closing');
  setTimeout(() => m.remove(), 200);
}

// F17 · vuela a la más barata cerca de ti (≤12 km; si no hay, la más barata de la isla)
export function flyToCheapestNear() {
  if (!A || !map || !lastPos) return false;
  const { stations, priceOf } = A;
  const avail = stations.filter((s) => priceOf(s) != null);
  const near = avail.filter((s) => (s._km ?? 99) <= 12);
  const pool = near.length ? near : avail;
  if (!pool.length) return false;
  const best = pool.reduce((m, s) => (priceOf(s) < priceOf(m) || (priceOf(s) === priceOf(m) && s.id < m.id)) ? s : m, pool[0]);
  const land = () => {
    const mk = pinMarkers[best.id];
    const el = mk && mk.getElement() && mk.getElement().querySelector('.pin');
    if (el) { el.classList.remove('is-landing'); void el.offsetWidth; el.classList.add('is-landing'); }
    openMini(best);
  };
  if (reduced()) { map.setView([best.lat, best.lng], 14); setTimeout(land, 60); }
  else { map.flyTo([best.lat, best.lng], 14, { duration: 1.1 }); map.once('moveend', () => setTimeout(land, 80)); }
  return true;
}

// F4 · proyección lat/lng → punto del contenedor del mapa (para el vuelo de precios)
export function mapProject(lat, lng) {
  if (!map) return null;
  const p = map.latLngToContainerPoint([lat, lng]);
  return { x: p.x, y: p.y };
}
