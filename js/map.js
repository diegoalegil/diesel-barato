// Mapa Leaflet con tiles CARTO, cargado solo cuando se necesita.

const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';

const TILES_LIGHT = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILES_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

const TENERIFE_BOUNDS = [[27.98, -16.95], [28.62, -16.10]];

let leafletReady = null;
let map = null;
let pinLayer = null;
let userMarker = null;

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

export async function showMap({ stations, fuel, qClassOf, fmtPrice, pos, onSelect }) {
  const L = await loadLeaflet();
  const container = document.getElementById('map');
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  if (!map) {
    map = L.map(container, { zoomControl: false, attributionControl: true });
    if (location.hostname === 'localhost') window.__map = map;
    L.tileLayer(dark ? TILES_DARK : TILES_LIGHT, { attribution: ATTRIB, maxZoom: 18 }).addTo(map);
    map.fitBounds(TENERIFE_BOUNDS, { padding: [10, 10] });
    map.on('zoomend', () => {
      container.classList.toggle('zoomed-out', map.getZoom() < 11);
    });
    container.classList.toggle('zoomed-out', map.getZoom() < 11);
  }

  updatePins({ stations, fuel, qClassOf, fmtPrice, onSelect });

  if (pos) {
    const icon = L.divIcon({ className: 'pin-wrap', html: '<div class="user-dot"></div>', iconSize: [0, 0] });
    if (userMarker) userMarker.setLatLng([pos.lat, pos.lng]);
    else userMarker = L.marker([pos.lat, pos.lng], { icon, zIndexOffset: 500, interactive: false }).addTo(map);
  }

  // el contenedor estaba oculto: recalcular tamaño
  requestAnimationFrame(() => map.invalidateSize());
}

export function updatePins({ stations, fuel, qClassOf, fmtPrice, onSelect }) {
  if (!map || !window.L) return;
  const L = window.L;
  if (pinLayer) pinLayer.remove();
  pinLayer = L.layerGroup();

  for (const s of stations) {
    const price = s.prices[fuel];
    if (price == null) continue;
    const icon = L.divIcon({
      className: 'pin-wrap',
      html: `<div class="pin ${qClassOf(price)}">${fmtPrice(price)}</div>`,
      iconSize: [0, 0],
    });
    L.marker([s.lat, s.lng], { icon })
      .on('click', () => onSelect(s))
      .addTo(pinLayer);
  }
  pinLayer.addTo(map);
}

export function flyTo(pos) {
  if (map && pos) map.flyTo([pos.lat, pos.lng], 13, { duration: 0.8 });
}
