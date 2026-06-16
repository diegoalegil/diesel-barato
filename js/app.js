import { loadStations, FUELS } from './api.js';
import { haversineKm, formatKm, requestPosition, permissionState, appleMapsUrl, googleMapsUrl } from './geo.js';
import { openSheet, closeSheet } from './sheet.js';
import { showMap, updatePins } from './map.js';

// ---------- estado ----------

const state = {
  stations: [],
  fecha: null,
  fromCache: false,
  fuel: 'diesel', // clave de combustible o 'repsol' (comparador con descuento)
  sort: 'price',
  dto: 5, // descuento Repsol en céntimos por litro
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
const dtoRow = $('dtoRow');
const dtoSeg = $('dtoSeg');
const verdictEl = $('verdict');
const statMinLabel = $('statMinLabel');
const statAvgLabel = $('statAvgLabel');
const statSaveLabel = $('statSaveLabel');

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
  // solo partículas de enlace en minúscula; los artículos de topónimos
  // ("El Ramonal", "La Caleta") conservan la mayúscula
  const particles = new Set(['de', 'del', 'y']);
  return clean.split(/\s+/).map((w, i) => {
    const lw = w.toLowerCase();
    if (i > 0 && particles.has(lw)) return lw; // "Red de Combustibles"
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

// logos locales de las marcas con presencia en la isla
const BRAND_LOGOS = [
  ['repsol', 'repsol'], ['cepsa', 'cepsa'], ['moeve', 'moeve'], ['shell', 'shell'],
  ['disa', 'disa'], ['pcan', 'pcan'], ['tgas', 'tgas'], ['plenergy', 'plenergy'],
  ['oceano', 'oceano'], ['canary oil', 'canaryoil'], ['bp', 'bp'],
  ['petroprix', 'petroprix'],
  ['red de combustibles', 'redcanarios'],
  ['gmoil', 'gmoil'],
  ['el mirador', 'cepsa'], // E.S. El Mirador (Los Realejos) opera bajo Cepsa
  ['la caleta', 'cepsa'],  // E.S. La Caleta (Garachico) opera bajo Cepsa
];

// se resuelve para cada estaci\u00f3n en el comparador del orden (ruta caliente): memoizar
const _brandKeyCache = new Map();

function brandKey(brand) {
  if (_brandKeyCache.has(brand)) return _brandKeyCache.get(brand);
  const b = String(brand).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  let result = null;
  for (const [key, file] of BRAND_LOGOS) {
    if (b === key || b.startsWith(key + ' ') || b.startsWith(key + '-') ||
        b.includes(' ' + key + ' ') || b.endsWith(' ' + key)) {
      result = file;
      break;
    }
  }
  _brandKeyCache.set(brand, result);
  return result;
}

function brandLogo(brand) {
  const k = brandKey(brand);
  return k ? `icons/brands/${k}.png` : null;
}

const isRepsol = (s) => brandKey(s.brand) === 'repsol';

// combustible real del modo actual (el comparador Repsol trabaja sobre di\u00e9sel)
const fuelKey = () => (state.fuel === 'repsol' ? 'diesel' : state.fuel);

// precio efectivo: en modo Repsol, las Repsol llevan el descuento aplicado
function priceOf(s) {
  const p = s.prices[fuelKey()];
  if (p == null) return null;
  return state.fuel === 'repsol' && isRepsol(s) ? p - state.dto / 100 : p;
}

function monoHTML(s, name) {
  const logo = brandLogo(s.brand);
  const img = logo ? `<img src="${logo}" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<span class="mono${logo ? ' mono-img' : ''}" style="--mono:${monoColor(s.brand)}">${monogram(name)}${img}</span>`;
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

function stationsAvailable() {
  return state.stations.filter((s) => priceOf(s) != null);
}

function makeQClass() {
  const prices = stationsAvailable().map(priceOf).sort((a, b) => a - b);
  if (!prices.length) return () => 'q1';
  const q = (p) => prices[Math.min(prices.length - 1, Math.floor(p * prices.length))];
  const qs = [q(0.25), q(0.5), q(0.75)];
  return (price) => (price <= qs[0] ? 'q0' : price <= qs[1] ? 'q1' : price <= qs[2] ? 'q2' : 'q3');
}

function sortedStations() {
  const list = stationsAvailable();
  if (state.sort === 'near' && state.pos) {
    return list.sort((a, b) => (a._km ?? 1e9) - (b._km ?? 1e9) || priceOf(a) - priceOf(b));
  }
  return list.sort((a, b) => priceOf(a) - priceOf(b) || (a._km ?? 1e9) - (b._km ?? 1e9));
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
  if (el._anim) { el._anim(); el._anim = null; }
  if (!Number.isFinite(from) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = format(to);
    return;
  }
  const t0 = performance.now();
  const dur = 450;
  let raf = 0;
  const finish = () => {
    clearTimeout(guard);
    cancelAnimationFrame(raf);
    el._anim = null;
    el.textContent = format(to);
  };
  // si rAF queda suspendido (pestaña oculta), el valor final se fija igualmente
  const guard = setTimeout(finish, dur + 100);
  el._anim = () => { clearTimeout(guard); cancelAnimationFrame(raf); };
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    if (p >= 1) { finish(); return; }
    el.textContent = format(from + (to - from) * (1 - (1 - p) ** 3));
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

function renderStats() {
  const list = stationsAvailable();
  if (!list.length) {
    statMin.textContent = statAvg.textContent = statSave.textContent = '—';
    return;
  }

  if (state.fuel === 'repsol') {
    const reps = list.filter(isRepsol);
    const others = list.filter((s) => !isRepsol(s));
    statMinLabel.textContent = 'Mejor Repsol';
    statAvgLabel.textContent = 'Mejor del resto';
    statSaveLabel.textContent = 'Diferencia (50 L)';
    if (!reps.length || !others.length) {
      statMin.textContent = statAvg.textContent = statSave.textContent = '—';
      return;
    }
    const bestR = Math.min(...reps.map(priceOf));
    const bestO = Math.min(...others.map(priceOf));
    const diff = (bestO - bestR) * 50; // positivo = la Repsol te ahorra dinero
    animateValue(statMin, bestR, (v) => `${nfPrice.format(v)} €`);
    animateValue(statAvg, bestO, (v) => `${nfPrice.format(v)} €`);
    animateValue(statSave, diff, (v) => `${v >= 0 ? '+' : '−'}${nfEuro.format(Math.abs(v))} €`);
    statSave.classList.toggle('is-cost', diff < 0);
    return;
  }

  statMinLabel.textContent = 'Más barata';
  statAvgLabel.textContent = 'Media de la isla';
  statSaveLabel.textContent = 'Ahorro por depósito';
  statSave.classList.remove('is-cost');
  const prices = list.map(priceOf);
  const min = Math.min(...prices);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  animateValue(statMin, min, (v) => `${nfPrice.format(v)} €`);
  animateValue(statAvg, avg, (v) => `${nfPrice.format(v)} €`);
  animateValue(statSave, (avg - min) * 50, (v) => `${nfEuro.format(v)} €`);
}

function renderVerdict() {
  if (state.fuel !== 'repsol') {
    verdictEl.hidden = true;
    return;
  }
  const list = stationsAvailable();
  const reps = list.filter(isRepsol);
  const others = list.filter((s) => !isRepsol(s));
  if (!reps.length || !others.length) {
    verdictEl.hidden = true;
    return;
  }
  const bestR = reps.reduce((m, s) => (priceOf(s) < priceOf(m) ? s : m));
  const bestO = others.reduce((m, s) => (priceOf(s) < priceOf(m) ? s : m));
  const pr = priceOf(bestR);
  const po = priceOf(bestO);
  const win = pr <= po;
  verdictEl.classList.remove('win', 'lose');
  verdictEl.classList.add(win ? 'win' : 'lose');
  verdictEl.innerHTML = win
    ? `<strong>Te compensa la Repsol</strong> de ${shortTown(bestR.town)}: ${fmtPrice(pr)} € frente a ${fmtPrice(po)} € de ${brandCase(bestO.brand)}.`
    : `<strong>Sale mejor ${brandCase(bestO.brand)}</strong> (${shortTown(bestO.town)}): ${fmtPrice(po)} € frente a ${fmtPrice(pr)} € de la mejor Repsol.`;
  verdictEl.hidden = false;
}

const BEST_TAG =
  '<span class="best-tag"><svg class="tag-ic" aria-hidden="true"><use href="#il-drop"/></svg>Mejor precio de la isla</span>';

function cardHTML(s, rank, qClassOf, cheapestId, animate) {
  const price = priceOf(s);
  const base = s.prices[fuelKey()];
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
      ${monoHTML(s, name)}
      <span class="card-main">
        <span class="card-name">${name}</span>
        <span class="card-meta">${meta}</span>
        ${tag}
      </span>
      <span class="card-price ${qClassOf(price)}">
        <span class="price-line">
          ${price !== base ? `<span class="old">${fmtPrice(base)}</span>` : ''}
          <span class="num">${fmtPrice(price)}</span>
        </span>
        <span class="unit">€ / litro</span>
      </span>
    </button>
  </li>`;
}

function renderList(animate = true) {
  const list = sortedStations();
  const qClassOf = makeQClass();
  const cheapestId = list.length
    ? list.reduce((m, s) => (priceOf(s) < priceOf(m) ? s : m), list[0]).id
    : null;

  if (!list.length) {
    listEl.innerHTML = `<li class="empty-card">
      <svg class="empty-ic" aria-hidden="true"><use href="#il-pump"/></svg>
      Ninguna gasolinera vende este combustible en Tenerife.
    </li>`;
    return;
  }
  listEl.innerHTML = list.map((s, i) => cardHTML(s, i, qClassOf, cheapestId, animate)).join('');

  heroCount.textContent = state.fuel === 'repsol'
    ? `Tenerife · ${list.length} gasolineras · Repsol con −${state.dto} ct`
    : `Tenerife · ${list.length} gasolineras con ${FUELS.find((f) => f.key === state.fuel).label}`;
}

function renderUpdated() {
  if (!state.fecha) return;
  const u = formatUpdated(state.fecha);
  updatedInline.textContent = state.fromCache ? `sin conexión · ${u.long}` : u.long;
  updatedChipText.textContent = u.short;
}

function renderAll(animate = true) {
  renderStats();
  renderVerdict();
  renderList(animate);
  renderUpdated();
}

// ---------- hoja de detalle ----------

function sheetHTML(s) {
  const st = scheduleStatus(s.schedule);
  const name = brandCase(s.brand);
  const myPrice = priceOf(s);
  const cheapest = myPrice != null && stationsAvailable().every((o) => myPrice <= priceOf(o));

  const townLine = [shortTown(s.town), s._km != null ? `a ${formatKm(s._km)}` : null].filter(Boolean).join(' · ');

  const cells = FUELS.filter((f) => s.prices[f.key] != null).map((f) => `
    <div class="price-cell ${f.key === fuelKey() ? 'selected' : ''}">
      <span class="price-cell-label">${f.full}</span>
      <span class="price-cell-value">${fmtPrice(s.prices[f.key])} €</span>
    </div>`).join('');

  const openSub = st
    ? (st.always ? 'Abierto 24 horas' : st.open ? `Abierto ahora${st.until ? ` · cierra a las ${st.until}` : ''}` : 'Cerrado ahora')
    : '';

  return `
    <div class="sheet-head">
      ${monoHTML(s, name)}
      <div>
        <div class="sheet-name">${name}</div>
        <div class="sheet-town">${townLine}</div>
        ${cheapest ? BEST_TAG : ''}
      </div>
    </div>
    <div class="sheet-rows">
      <div class="sheet-row">
        <svg class="ilc" aria-hidden="true"><use href="#il-pin"/></svg>
        <span class="sheet-row-text">${titleCase(s.address)}
          <span class="sheet-row-sub">${shortTown(s.locality || s.town)}</span>
        </span>
      </div>
      ${s.schedule ? `<div class="sheet-row">
        <svg class="ilc" aria-hidden="true"><use href="#il-clock"/></svg>
        <span class="sheet-row-text">${s.schedule}
          ${openSub ? `<span class="sheet-row-sub ${st.open ? 'is-open' : 'is-closed'}">${openSub}</span>` : ''}
        </span>
      </div>` : ''}
      ${state.fuel === 'repsol' && isRepsol(s) && s.prices.diesel != null ? `<div class="sheet-row">
        <svg class="ilc" aria-hidden="true"><use href="#il-coin"/></svg>
        <span class="sheet-row-text">Con tu descuento de −${state.dto} ct
          <span class="sheet-row-sub">Pagarías ${fmtPrice(priceOf(s))} €/L de diésel</span>
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
  dtoRow.hidden = state.fuel !== 'repsol';
  renderAll(true);
});

dtoSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-dto]');
  if (!btn || +btn.dataset.dto === state.dto) return;
  state.dto = +btn.dataset.dto;
  setSeg(dtoSeg, 'dto', String(state.dto));
  renderAll(false); // comparación instantánea: sin re-animar la lista entera
  if (state.mapOpen) updatePins(mapArgs());
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
      renderAll(false);
    } catch {
      setSeg(sortSeg, 'sort', state.sort);
      toast('No se pudo acceder a tu ubicación');
    }
    return;
  }
  state.sort = btn.dataset.sort;
  setSeg(sortSeg, 'sort', state.sort);
  renderAll(false); // reordenar es instantáneo, no re-anima 200 tarjetas
});

// ---------- mapa ----------

function mapArgs() {
  return {
    stations: state.stations,
    priceOf,
    qClassOf: makeQClass(),
    fmtPrice,
    onSelect: openStation,
  };
}

mapBtn.addEventListener('click', async () => {
  state.mapOpen = true;
  mapView.hidden = false;
  try {
    await showMap({ ...mapArgs(), pos: state.pos });
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
  }, 300); // = duración de map-out
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
      updatePins(mapArgs());
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
  // el descuento Repsol siempre arranca en −5 ct
  setSeg(fuelSeg, 'fuel', state.fuel);
  setSeg(sortSeg, 'sort', state.sort);
  setSeg(dtoSeg, 'dto', String(state.dto));

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  const dataReady = refresh({ silent: true });

  // Auto-localización al entrar SOLO si es 100% segura y silenciosa:
  // - permissions.query confirma permiso ya concedido (esta consulta nunca abre diálogo),
  // - y no estamos en modo PWA standalone (en iOS el permiso no persiste entre sesiones y
  //   en standalone ni 'granted' es fiable: ahí podría re-abrir el diálogo).
  // En cualquier otro caso no se pide nada: el diálogo solo aparece al tocar "Más cercanas".
  const autoLocate = () => {
    if (state.pos) return; // ya localizado (p. ej. el usuario tocó "Más cercanas" antes)
    requestPosition()
      .then(async (p) => {
        state.pos = p;
        await dataReady;
        computeDistances();
        renderAll(false);
      })
      .catch(() => {}); // si fallara, se queda el orden por precio, sin ruido
  };

  if (!isStandalone) {
    permissionState().then((st) => { if (st === 'granted') autoLocate(); });
  }
}

init();
