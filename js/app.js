import { loadStations, FUELS } from './api.js';
import { haversineKm, formatKm, requestPosition, wasGranted, appleMapsUrl, googleMapsUrl } from './geo.js';
import { openSheet, closeSheet } from './sheet.js';
import { showMap, updatePins } from './map.js';

// ---------- estado ----------

const state = {
  stations: [],
  fecha: null,
  fromCache: false,
  fuel: 'diesel',
  sort: 'price',
  pos: null,
  mapOpen: false,
};

// ---------- referencias DOM ----------

const $ = (id) => document.getElementById(id);
const listEl = $('list');
const statsEl = $('stats');
const statMin = $('statMin');
const statAvg = $('statAvg');
const statSave = $('statSave');
const heroCount = $('heroCount');
const updatedInline = $('updatedInline');
const updatedChip = $('updatedChip');
const updatedChipText = $('updatedChipText');
const fuelSeg = $('fuelSeg');
const sortSeg = $('sortSeg');
const mapBtn = $('mapBtn');
const mapView = $('mapView');
const mapClose = $('mapClose');
const errorState = $('errorState');
const retryBtn = $('retryBtn');
const topbar = $('topbar');
const toastEl = $('toast');
const ptrEl = $('ptr');

// ---------- utilidades de formato ----------

const nfPrice = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const nfEuro = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtPrice = (n) => nfPrice.format(n);

const SMALL_WORDS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'en', 'a', 'al']);

function titleCase(str) {
  return String(str).toLowerCase().split(/\s+/).map((w, i) => {
    if (/^[a-z]{1,3}-\d/.test(w)) return w.toUpperCase(); // carreteras: TF-1
    if (/^s\/n/.test(w)) return w; // "s/n" (sin número)
    if (i > 0 && SMALL_WORDS.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

function brandCase(str) {
  // fuera sufijos societarios y el prefijo "E.S." (estación de servicio)
  const clean = String(str).trim()
    .replace(/[\s,]+(s\.?\s?l\.?u?|s\.?\s?a\.?u?|c\.?\s?b|s\.?\s?coop\w*)\.?$/i, '')
    .replace(/^(e\.?\s?s\.?|eess|estaci[oó]n de servicio)\s+/i, '')
    .trim() || String(str).trim();
  return clean.split(/\s+/).map((w) => {
    const lw = w.toLowerCase();
    if (w.length <= 2 && !SMALL_WORDS.has(lw)) return w.toUpperCase(); // BP
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
}

// nombres cortos de municipio, como se dicen en la isla
const TOWN_SHORT = {
  'san cristóbal de la laguna': 'La Laguna',
  'santa cruz de tenerife': 'Santa Cruz',
  'granadilla de abona': 'Granadilla',
  'san miguel de abona': 'San Miguel',
  'icod de los vinos': 'Icod',
  'la victoria de acentejo': 'La Victoria',
  'la matanza de acentejo': 'La Matanza',
  'buenavista del norte': 'Buenavista',
  'san juan de la rambla': 'San Juan de la Rambla',
};

function shortTown(town) {
  const t = String(town).trim();
  // "Realejos (Los)" → "Los Realejos"
  const m = t.match(/^(.+?)\s*\((el|la|los|las)\)$/i);
  if (m) return titleCase(`${m[2]} ${m[1]}`);
  return TOWN_SHORT[t.toLowerCase()] || titleCase(t);
}

const MONO_COLORS = ['#BC6242', '#8C6B4F', '#7C8F62', '#B08A45', '#A65B3F', '#6E7D54', '#9D7F4E', '#996A56'];

function monoColor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return MONO_COLORS[h % MONO_COLORS.length];
}

function monogram(name) {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return words[0].slice(0, 2).charAt(0).toUpperCase() + words[0].slice(1, 2).toLowerCase();
}

function formatUpdated(ts) {
  const d = new Date(ts);
  const now = new Date();
  const hm = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) {
    return { long: `actualizado hoy a las ${hm}`, short: `hoy ${hm}` };
  }
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) {
    return { long: `actualizado ayer a las ${hm}`, short: `ayer ${hm}` };
  }
  const dm = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  return { long: `actualizado el ${dm}`, short: dm };
}

// ---------- horarios ----------

const DAY_INDEX = { L: 0, M: 1, X: 2, J: 3, V: 4, S: 5, D: 6 };

function scheduleStatus(str) {
  if (!str) return null;
  const now = new Date();
  const today = (now.getDay() + 6) % 7;
  const mins = now.getHours() * 60 + now.getMinutes();
  let coversToday = false;
  let openNow = false;
  let until = null;

  for (const seg of str.split(';')) {
    const m = seg.trim().match(/^([LMXJVSD])(?:\s*-\s*([LMXJVSD]))?\s*:\s*(.+)$/i);
    if (!m) return null; // formato desconocido: mejor no afirmar nada
    const a = DAY_INDEX[m[1].toUpperCase()];
    const b = m[2] ? DAY_INDEX[m[2].toUpperCase()] : a;
    const inRange = a <= b ? today >= a && today <= b : today >= a || today <= b;
    if (!inRange) continue;
    coversToday = true;
    if (/24\s*h/i.test(m[3])) return { open: true, always: true };
    const re = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g;
    let r;
    while ((r = re.exec(m[3]))) {
      const s = +r[1] * 60 + +r[2];
      const e = +r[3] * 60 + +r[4];
      const within = s <= e ? mins >= s && mins < e : mins >= s || mins < e;
      if (within) {
        openNow = true;
        until = `${String(r[3]).padStart(2, '0')}:${r[4]}`;
      }
    }
  }
  if (!coversToday) return { open: false };
  return openNow ? { open: true, until } : { open: false };
}

function openLabel(st) {
  if (!st) return '';
  if (st.always) return '<span class="is-open">24 h</span>';
  if (st.open) return '<span class="is-open">Abierto</span>';
  return '<span class="is-closed">Cerrado</span>';
}

// ---------- derivados ----------

function stationsForFuel(fuel) {
  return state.stations.filter((s) => s.prices[fuel] != null);
}

function quantilesFor(fuel) {
  const prices = stationsForFuel(fuel).map((s) => s.prices[fuel]).sort((a, b) => a - b);
  if (!prices.length) return [0, 0, 0];
  const q = (p) => prices[Math.min(prices.length - 1, Math.floor(p * prices.length))];
  return [q(0.25), q(0.5), q(0.75)];
}

function makeQClass(fuel) {
  const qs = quantilesFor(fuel);
  return (price) => (price <= qs[0] ? 'q0' : price <= qs[1] ? 'q1' : price <= qs[2] ? 'q2' : 'q3');
}

function sortedStations() {
  const list = stationsForFuel(state.fuel);
  if (state.sort === 'near' && state.pos) {
    return list.sort((a, b) => (a._km ?? 1e9) - (b._km ?? 1e9) || a.prices[state.fuel] - b.prices[state.fuel]);
  }
  return list.sort((a, b) => a.prices[state.fuel] - b.prices[state.fuel] || (a._km ?? 1e9) - (b._km ?? 1e9));
}

function computeDistances() {
  if (!state.pos) return;
  for (const s of state.stations) {
    s._km = haversineKm(state.pos.lat, state.pos.lng, s.lat, s.lng);
  }
}

// ---------- render ----------

function animateValue(el, to, format) {
  const from = parseFloat(el.dataset.v ?? 'NaN');
  el.dataset.v = String(to);
  if (!Number.isFinite(from) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = format(to);
    return;
  }
  const t0 = performance.now();
  const dur = 450;
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const eased = 1 - (1 - p) ** 3;
    el.textContent = format(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function renderStats() {
  const list = stationsForFuel(state.fuel);
  if (!list.length) {
    statMin.textContent = statAvg.textContent = statSave.textContent = '—';
    return;
  }
  const prices = list.map((s) => s.prices[state.fuel]);
  const min = Math.min(...prices);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  animateValue(statMin, min, (v) => `${nfPrice.format(v)} €`);
  animateValue(statAvg, avg, (v) => `${nfPrice.format(v)} €`);
  animateValue(statSave, (avg - min) * 50, (v) => `${nfEuro.format(v)} €`);
}

const BEST_TAG =
  '<span class="best-tag"><svg class="tag-ic" aria-hidden="true"><use href="#il-drop"/></svg>Mejor precio de la isla</span>';

function cardHTML(s, rank, qClassOf, cheapestId, animate) {
  const price = s.prices[state.fuel];
  const st = scheduleStatus(s.schedule);
  const open = openLabel(st);
  const name = brandCase(s.brand);
  const tag = s.id === cheapestId ? BEST_TAG : '';
  const anim = animate ? ` enter" style="--d:${Math.min(rank, 13)}` : '';
  const meta =
    `<span class="meta-town">${shortTown(s.town)}</span>` +
    (s._km != null ? `<span class="meta-fix">· a ${formatKm(s._km)}</span>` : '') +
    (open ? `<span class="meta-fix">· ${open}</span>` : '');
  return `<li class="card${anim}">
    <button class="card-btn" data-id="${s.id}">
      <span class="mono" style="--mono:${monoColor(s.brand)}">${monogram(name)}</span>
      <span class="card-main">
        <span class="card-name">${name}</span>
        <span class="card-meta">${meta}</span>
        ${tag}
      </span>
      <span class="card-price ${qClassOf(price)}">
        <span class="num">${fmtPrice(price)}</span>
        <span class="unit">€ / litro</span>
      </span>
    </button>
  </li>`;
}

function renderList(animate = true) {
  const list = sortedStations();
  const qClassOf = makeQClass(state.fuel);
  const cheapestId = list.length
    ? list.reduce((m, s) => (s.prices[state.fuel] < m.prices[state.fuel] ? s : m), list[0]).id
    : null;

  if (!list.length) {
    listEl.innerHTML = `<li class="empty-card">
      <svg class="empty-ic" aria-hidden="true"><use href="#il-pump"/></svg>
      Ninguna gasolinera vende este combustible en Tenerife.
    </li>`;
    return;
  }
  listEl.innerHTML = list.map((s, i) => cardHTML(s, i, qClassOf, cheapestId, animate)).join('');

  const fuelName = FUELS.find((f) => f.key === state.fuel).label;
  heroCount.textContent = `Tenerife · ${list.length} gasolineras con ${fuelName}`;
}

function renderUpdated() {
  if (!state.fecha) return;
  const u = formatUpdated(state.fecha);
  updatedInline.textContent = state.fromCache ? `sin conexión · ${u.long}` : u.long;
  updatedChipText.textContent = u.short;
}

function renderAll(animate = true) {
  renderStats();
  renderList(animate);
  renderUpdated();
}

// ---------- hoja de detalle ----------

function sheetHTML(s) {
  const st = scheduleStatus(s.schedule);
  const name = brandCase(s.brand);
  const qClassOf = makeQClass(state.fuel);
  const cheapest = stationsForFuel(state.fuel)
    .every((o) => (s.prices[state.fuel] ?? Infinity) <= o.prices[state.fuel]);

  const townLine = [shortTown(s.town), s._km != null ? `a ${formatKm(s._km)}` : null].filter(Boolean).join(' · ');

  const cells = FUELS.filter((f) => s.prices[f.key] != null).map((f) => `
    <div class="price-cell ${f.key === state.fuel ? 'selected' : ''}">
      <span class="price-cell-label">${f.full}</span>
      <span class="price-cell-value">${fmtPrice(s.prices[f.key])} €</span>
    </div>`).join('');

  const openSub = st
    ? (st.always ? 'Abierto 24 horas' : st.open ? `Abierto ahora${st.until ? ` · cierra a las ${st.until}` : ''}` : 'Cerrado ahora')
    : '';

  return `
    <div class="sheet-head">
      <span class="mono" style="--mono:${monoColor(s.brand)}">${monogram(name)}</span>
      <div>
        <div class="sheet-name">${name}</div>
        <div class="sheet-town">${townLine}</div>
        ${cheapest && s.prices[state.fuel] != null ? BEST_TAG : ''}
      </div>
    </div>
    <div class="sheet-rows">
      <div class="sheet-row">
        <svg class="ilc" aria-hidden="true"><use href="#il-pin"/></svg>
        <span class="sheet-row-text">${titleCase(s.address)}
          <span class="sheet-row-sub">${titleCase(s.locality || s.town)}</span>
        </span>
      </div>
      ${s.schedule ? `<div class="sheet-row">
        <svg class="ilc" aria-hidden="true"><use href="#il-clock"/></svg>
        <span class="sheet-row-text">${s.schedule}
          ${openSub ? `<span class="sheet-row-sub ${st.open ? 'is-open' : 'is-closed'}">${openSub}</span>` : ''}
        </span>
      </div>` : ''}
    </div>
    <div class="price-grid">${cells}</div>
    <div class="sheet-actions">
      <a class="action-btn primary" href="${appleMapsUrl(s.lat, s.lng, name)}" target="_blank" rel="noopener">
        <svg class="ic"><use href="#i-nav"/></svg> Apple Maps
      </a>
      <a class="action-btn secondary" href="${googleMapsUrl(s.lat, s.lng)}" target="_blank" rel="noopener">
        <svg class="ic"><use href="#i-map"/></svg> Google Maps
      </a>
    </div>`;
}

function openStation(s) {
  openSheet(sheetHTML(s));
}

listEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-id]');
  if (!btn) return;
  const s = state.stations.find((x) => x.id === btn.dataset.id);
  if (s) openStation(s);
});

// ---------- toast ----------

let toastTimer = null;

function toast(msg, ms = 2600) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

// ---------- segmented controls ----------

function setSeg(seg, attr, value) {
  const btns = [...seg.querySelectorAll('.seg-btn')];
  const idx = btns.findIndex((b) => b.dataset[attr] === value);
  if (idx < 0) return;
  seg.querySelector('.seg-thumb').style.setProperty('--i', idx);
  btns.forEach((b, i) => b.setAttribute('aria-pressed', String(i === idx)));
}

fuelSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-fuel]');
  if (!btn || btn.dataset.fuel === state.fuel) return;
  state.fuel = btn.dataset.fuel;
  setSeg(fuelSeg, 'fuel', state.fuel);
  renderAll(true);
});

sortSeg.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-sort]');
  if (!btn || btn.dataset.sort === state.sort) return;

  if (btn.dataset.sort === 'near' && !state.pos) {
    setSeg(sortSeg, 'sort', 'near');
    try {
      state.pos = await requestPosition();
      computeDistances();
      state.sort = 'near';
      renderAll(true);
    } catch {
      setSeg(sortSeg, 'sort', state.sort);
      toast('No se pudo acceder a tu ubicación');
    }
    return;
  }
  state.sort = btn.dataset.sort;
  setSeg(sortSeg, 'sort', state.sort);
  renderAll(true);
});

// ---------- mapa ----------

mapBtn.addEventListener('click', async () => {
  state.mapOpen = true;
  mapView.hidden = false;
  try {
    await showMap({
      stations: state.stations,
      fuel: state.fuel,
      qClassOf: makeQClass(state.fuel),
      fmtPrice,
      pos: state.pos,
      onSelect: openStation,
    });
  } catch {
    mapView.hidden = true;
    state.mapOpen = false;
    toast('No se pudo cargar el mapa');
  }
});

mapClose.addEventListener('click', () => {
  closeSheet();
  mapView.classList.add('closing');
  setTimeout(() => {
    mapView.hidden = true;
    mapView.classList.remove('closing');
    state.mapOpen = false;
  }, 290);
});

// ---------- carga de datos ----------

async function refresh({ silent = false } = {}) {
  updatedChip.classList.add('spinning');
  try {
    const data = await loadStations();
    state.stations = data.stations;
    state.fecha = data.fecha;
    state.fromCache = data.fromCache;
    computeDistances();
    errorState.hidden = true;
    listEl.hidden = false;
    statsEl.style.opacity = '';
    renderAll(true);
    if (state.mapOpen) {
      updatePins({ stations: state.stations, fuel: state.fuel, qClassOf: makeQClass(state.fuel), fmtPrice, onSelect: openStation });
    }
    if (data.fromCache && !silent) toast('Sin conexión · mostrando los últimos precios guardados');
  } catch {
    if (!state.stations.length) {
      listEl.hidden = true;
      errorState.hidden = false;
      statsEl.style.opacity = '0.35';
    } else if (!silent) {
      toast('No se pudieron actualizar los precios');
    }
  } finally {
    updatedChip.classList.remove('spinning');
    ptrReset();
  }
}

updatedChip.addEventListener('click', () => refresh());
updatedInline.addEventListener('click', () => refresh());
retryBtn.addEventListener('click', () => refresh());

// al volver a la app tras un rato, refrescar en silencio
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.fecha && Date.now() - state.fecha > 10 * 60 * 1000) {
    refresh({ silent: true });
  }
});

// ---------- barra compacta al hacer scroll ----------

const hero = document.querySelector('.hero');
let topbarShown = false;

function updateTopbar() {
  const show = window.scrollY > hero.offsetHeight - 24;
  if (show !== topbarShown) {
    topbarShown = show;
    topbar.setAttribute('data-shown', String(show));
  }
}

window.addEventListener('scroll', updateTopbar, { passive: true });
updateTopbar();

// ---------- tirar para refrescar (solo PWA instalada) ----------

const isStandalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
let ptr = null;

function ptrReset() {
  ptrEl.classList.remove('loading', 'armed');
  ptrEl.style.opacity = '';
  ptrEl.style.transform = '';
}

if (isStandalone) {
  document.addEventListener('touchstart', (e) => {
    if (window.scrollY > 2 || state.mapOpen || !errorState.hidden) return;
    if (document.querySelector('.sheet.open')) return;
    ptr = { y0: e.touches[0].clientY, pull: 0 };
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!ptr) return;
    const pull = e.touches[0].clientY - ptr.y0;
    if (pull <= 0 || window.scrollY > 2) { ptr.pull = 0; return; }
    ptr.pull = pull;
    const shift = Math.min(86, pull * 0.42);
    ptrEl.style.opacity = String(Math.min(1, shift / 58));
    ptrEl.style.transform = `translateY(${-56 + shift}px) rotate(${shift * 2.4}deg)`;
    ptrEl.classList.toggle('armed', shift > 62);
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (!ptr) return;
    const armed = ptrEl.classList.contains('armed');
    ptr = null;
    if (armed) {
      ptrEl.classList.add('loading');
      refresh();
    } else {
      ptrReset();
    }
  });
}

// ---------- arranque ----------

async function init() {
  setSeg(fuelSeg, 'fuel', state.fuel);
  setSeg(sortSeg, 'sort', state.sort);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  const dataReady = refresh({ silent: true });

  if (wasGranted()) {
    requestPosition()
      .then(async (p) => {
        state.pos = p;
        await dataReady;
        computeDistances();
        renderAll(false);
      })
      .catch(() => {});
  }
}

init();
