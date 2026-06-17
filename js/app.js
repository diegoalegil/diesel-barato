import { loadStations, FUELS } from './api.js';
import { haversineKm, formatKm, requestPosition, permissionState, googleMapsUrl } from './geo.js';
import { openSheet, closeSheet } from './sheet.js';
import { showMap, updatePins } from './map.js';

// ---------- estado ----------

const state = {
  stations: [],
  fecha: null,
  fromCache: false,
  fuel: 'diesel',  // combustible: diesel | dieselPlus | g95 | g98
  mode: null,      // app de descuento activa: null | 'waylet' | 'moeve' | 'disa'
  sort: 'price',
  dto: 5,          // céntimos de descuento de la app activa
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
const topbarPrice = $('topbarPrice'); // F6: la cifra más barata migra al topbar
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
const appsRow = $('appsRow');
const verdictEl = $('verdict');
const premiumTip = $('premiumTip');
const gastosBtn = $('gastosBtn');
const mainEl = $('main');
const logView = $('logView');
const logClose = $('logClose');
const logBody = $('logBody');
const sheetBody = $('sheetBody');
const statMinLabel = $('statMinLabel');
const statAvgLabel = $('statAvgLabel');
const statSaveLabel = $('statSaveLabel');

// ---------- utilidades de formato ----------

const nfPrice = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const nfEuro = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtPrice = (n) => nfPrice.format(n);
// precio con € pegado por espacio duro ( ): en prosa, número y símbolo nunca se
// parten en dos líneas ("1,405\n€"). En las tarjetas el € va en su propio span, no hace falta.
const eur = (n) => `${nfPrice.format(n)} €`;

// espacio duro (U+00A0) para pegar cifra y unidad en prosa, p. ej. "6,2 L/100 km"
const NB = String.fromCharCode(160);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

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

// Apps de descuento. Cada una filtra a sus r\u00f3tulos y resta c\u00e9ntimos al precio.
// El match usa brandKey (normaliza acentos y mapea "el mirador"/"la caleta" \u2192 cepsa),
// no un substring crudo, para que las Cepsa "encubiertas" entren en el modo Moeve.
// Waylet\u2192Repsol \u00b7 Moeve(Club gow)\u2192Cepsa/Moeve \u00b7 DISA(Mi Energ\u00eda)\u2192Disa/Shell (Cepsa NO).
const DISCOUNT_MODES = {
  waylet: { app: 'Waylet', net: 'Repsol',      brands: ['repsol'],         tiers: [5, 10], note: 'saldo Waylet' },
  moeve:  { app: 'Moeve',  net: 'Cepsa/Moeve', brands: ['moeve', 'cepsa'], tiers: [5, 10], note: 'saldo Moeve gow' },
  disa:   { app: 'DISA',   net: 'Disa/Shell',  brands: ['disa', 'shell'],  tiers: [3, 5],  note: 'app Mi Energ\u00eda DISA' },
};

const inMode = (s) => !!state.mode && DISCOUNT_MODES[state.mode].brands.includes(brandKey(s.brand));

// precio efectivo: con una app activa, sus estaciones llevan el descuento aplicado
function priceOf(s) {
  const p = s.prices[state.fuel];
  if (p == null) return null;
  return inMode(s) ? p - state.dto / 100 : p;
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
  // El sello del Ministerio va en hora peninsular (+1 h sobre Canarias): pasada la
  // medianoche peninsular, el dato fresco llega fechado "mañana". Un sello en el futuro
  // solo puede ser ese desfase horario, nunca datos del futuro → trátalo como de hoy.
  if (d.toDateString() === now.toDateString() || d > now) {
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

// Escala de color relativa al conjunto que se MUESTRA: con una app activa son solo sus
// estaciones (¿cuál es barata dentro de esa red?), no toda la isla — así el verde/rojo
// es coherente con lo que ves. La comparación con el resto vive en stats y veredicto.
function makeQClass(pool) {
  const prices = (pool || stationsAvailable()).map(priceOf).filter((p) => p != null).sort((a, b) => a - b);
  if (!prices.length) return () => 'q1';
  const q = (p) => prices[Math.min(prices.length - 1, Math.floor(p * prices.length))];
  const qs = [q(0.25), q(0.5), q(0.75)];
  return (price) => (price <= qs[0] ? 'q0' : price <= qs[1] ? 'q1' : price <= qs[2] ? 'q2' : 'q3');
}

// Estación más barata de un conjunto, con desempate estable por id: así la etiqueta de
// la lista, el veredicto y la ficha siempre nombran la MISMA cuando hay precios iguales.
function cheapestStation(pool) {
  return pool.reduce((m, s) => {
    const d = priceOf(s) - priceOf(m);
    return d < 0 || (d === 0 && s.id < m.id) ? s : m;
  }, pool[0]);
}

function sortedStations() {
  // con una app activa, la lista muestra SOLO sus estaciones (con su descuento);
  // la comparación con el resto vive en las stats y el veredicto
  let list = stationsAvailable();
  if (state.mode) list = list.filter(inMode);
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

// F3 · contador rodillo mecánico (drop-in, misma firma animateValue(el, to, format)).
// Construye una columna por dígito; solo ruedan los que cambian; €, coma y signo fijos.
// El render reemplaza el contenido, así que es seguro ante re-renders rápidos (no hace falta _anim).
function animateValue(el, to, format) {
  const from = parseFloat(el.dataset.v ?? 'NaN');
  el.dataset.v = String(to);
  const newStr = format(to);
  if (!Number.isFinite(from) || reduced()) { renderRoller(el, newStr, null); return; }
  renderRoller(el, newStr, format(from));
}
function renderRoller(el, newStr, oldStr) {
  el.textContent = '';
  const wrap = document.createElement('span');
  wrap.className = 'digit-roll';
  const cols = [];
  const offset = oldStr ? newStr.length - oldStr.length : 0;
  for (let i = 0; i < newStr.length; i++) {
    const ch = newStr[i];
    if (ch >= '0' && ch <= '9') {
      const col = document.createElement('span'); col.className = 'col';
      const strip = document.createElement('span'); strip.className = 'strip';
      for (let d = 0; d <= 9; d++) { const sp = document.createElement('span'); sp.textContent = d; strip.appendChild(sp); }
      col.appendChild(strip); wrap.appendChild(col);
      cols.push({ strip, to: +ch, idx: i });
    } else {
      const sym = document.createElement('span'); sym.className = 'sym';
      sym.textContent = ch === ' ' ? ' ' : ch;
      wrap.appendChild(sym);
    }
  }
  el.appendChild(wrap);
  const setY = (d) => `translateY(${-d}em)`;
  cols.forEach((c, ci) => {
    if (!oldStr || reduced()) { c.strip.style.transform = setY(c.to); return; }
    const oldCh = oldStr[c.idx - offset];
    const oldD = (oldCh >= '0' && oldCh <= '9') ? +oldCh : c.to;
    if (oldD === c.to) { c.strip.style.transform = setY(c.to); return; }
    c.strip.style.transform = setY(oldD);
    c.strip.animate([{ transform: setY(oldD) }, { transform: setY(c.to) }],
      { duration: 540, delay: ci * 45, easing: 'cubic-bezier(0.34,1.4,0.64,1)', fill: 'forwards' });
  });
}

function renderStats() {
  const list = stationsAvailable();
  if (!list.length) {
    statMin.textContent = statAvg.textContent = statSave.textContent = '—';
    if (topbarPrice) topbarPrice.textContent = '—';
    return;
  }

  if (state.mode) {
    const cfg = DISCOUNT_MODES[state.mode];
    const mine = list.filter(inMode);
    const others = list.filter((s) => !inMode(s));
    statMinLabel.textContent = `Con ${cfg.app}`;
    statAvgLabel.textContent = 'Mejor del resto';
    statSaveLabel.textContent = 'Diferencia (50 L)';
    if (!mine.length || !others.length) {
      statMin.textContent = statAvg.textContent = statSave.textContent = '—';
      return;
    }
    const bestM = Math.min(...mine.map(priceOf));
    const bestO = Math.min(...others.map(priceOf));
    const diff = (bestO - bestM) * 50; // positivo = tu app te ahorra dinero
    if (topbarPrice) topbarPrice.textContent = eur(bestM);
    animateValue(statMin, bestM, (v) => `${nfPrice.format(v)} €`);
    animateValue(statAvg, bestO, (v) => `${nfPrice.format(v)} €`);
    animateValue(statSave, diff, (v) => `${v >= 0 ? '+' : '−'}${nfEuro.format(Math.abs(v))} €`);
    statSave.classList.toggle('is-cost', diff < 0);
    return;
  }

  statMinLabel.textContent = 'Más barata';
  statAvgLabel.textContent = 'Media de la isla';
  const prices = list.map(priceOf);
  const min = Math.min(...prices);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  if (topbarPrice) topbarPrice.textContent = eur(min);
  animateValue(statMin, min, (v) => `${nfPrice.format(v)} €`);
  animateValue(statAvg, avg, (v) => `${nfPrice.format(v)} €`);

  if (state.fuel === 'dieselPlus') {
    // sobreprecio del premium frente al diésel normal más barato
    const reg = state.stations.map((s) => s.prices.diesel).filter((p) => p != null);
    const extra = reg.length ? (min - Math.min(...reg)) * 50 : 0;
    statSaveLabel.textContent = 'Sobreprecio (50 L)';
    statSave.classList.toggle('is-cost', extra > 0.005);
    animateValue(statSave, Math.max(0, extra), (v) => `+${nfEuro.format(v)} €`);
  } else {
    statSaveLabel.textContent = 'Ahorro por depósito';
    statSave.classList.remove('is-cost');
    animateValue(statSave, (avg - min) * 50, (v) => `${nfEuro.format(v)} €`);
  }
}

function renderVerdict() {
  if (!state.mode) {
    verdictEl.hidden = true;
    return;
  }
  const cfg = DISCOUNT_MODES[state.mode];
  const list = stationsAvailable();
  const mine = list.filter(inMode);
  const others = list.filter((s) => !inMode(s));
  if (!mine.length || !others.length) {
    verdictEl.hidden = true;
    return;
  }
  const bestM = cheapestStation(mine);
  const bestO = cheapestStation(others);
  const pr = priceOf(bestM);
  const po = priceOf(bestO);
  const win = pr <= po;
  verdictEl.classList.remove('win', 'lose');
  verdictEl.classList.add(win ? 'win' : 'lose');
  verdictEl.innerHTML = win
    ? `<strong>Con ${cfg.app} te sale mejor</strong>: ${eur(pr)} en ${shortTown(bestM.town)} frente a ${eur(po)} de ${brandCase(bestO.brand)}.`
    : `<strong>Sale mejor ${brandCase(bestO.brand)}</strong> (${shortTown(bestO.town)}): ${eur(po)} frente a ${eur(pr)} con ${cfg.app}. <button class="verdict-link" data-id="${bestO.id}">Ver ${brandCase(bestO.brand)} →</button>`;
  verdictEl.hidden = false;
}

function bestTagHTML(label) {
  return `<span class="best-tag"><svg class="tag-ic" aria-hidden="true"><use href="#il-drop"/></svg>${label}</span>`;
}

// Consejo de diésel premium: solo en la pestaña Premium y sin app activa (para no apilar
// tarjetas con el veredicto). Recomienda un repostaje premium ocasional y destaca Shell.
function renderPremiumTip() {
  if (state.fuel !== 'dieselPlus' || state.mode) { premiumTip.hidden = true; return; }
  const prem = stationsAvailable(); // priceOf ya usa dieselPlus aquí
  if (!prem.length) { premiumTip.hidden = true; return; }
  const cheapest = cheapestStation(prem);
  const shells = prem.filter((s) => brandKey(s.brand) === 'shell');
  const shell = shells.length ? cheapestStation(shells) : null;
  const shellPart = shell
    ? ` <button class="verdict-link" data-id="${shell.id}">Shell V-Power: ${eur(priceOf(shell))} en ${shortTown(shell.town)} →</button>`
    : '';
  premiumTip.innerHTML =
    `<strong>Diésel premium</strong>: lleva aditivos que limpian el motor, va bien un depósito de vez en cuando. ` +
    `El más barato: ${brandCase(cheapest.brand)} a ${eur(priceOf(cheapest))}.${shellPart}`;
  premiumTip.hidden = false;
}

function cardHTML(s, rank, qClassOf, cheapestId, cheapestTag, animate) {
  const price = priceOf(s);
  const base = s.prices[state.fuel];
  const st = scheduleStatus(s.schedule);
  const open = openLabel(st);
  const name = brandCase(s.brand);
  const tag = s.id === cheapestId ? cheapestTag : '';
  const anim = animate ? ` enter" style="--d:${Math.min(rank, 13)}` : '';
  const meta =
    `<span class="meta-town">${shortTown(s.town)}</span>` +
    (s._km != null ? `<span class="meta-fix">· a ${formatKm(s._km)}</span>` : '') +
    (open ? `<span class="meta-fix">· ${open}</span>` : '');
  return `<li class="card${anim}" data-id="${s.id}">
    <button class="card-btn" data-id="${s.id}">
      <span class="sweep" aria-hidden="true"></span>
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

let champTimer = null;

function renderList(animate = true) {
  const list = sortedStations();
  const qClassOf = makeQClass(list); // colorear relativo a lo que se ve
  const cheapestId = list.length ? cheapestStation(list).id : null;
  const cfg = state.mode ? DISCOUNT_MODES[state.mode] : null;
  const cheapestTag = bestTagHTML(cfg ? `La más barata con ${cfg.app}` : 'Mejor precio de la isla');

  if (!list.length) {
    listEl.innerHTML = `<li class="empty-card">
      <svg class="empty-ic" aria-hidden="true"><use href="#il-pump"/></svg>
      ${cfg ? `No hay estaciones ${cfg.net} con este combustible ahora mismo.` : 'Ninguna gasolinera vende este combustible en Tenerife.'}
    </li>`;
    return;
  }
  listEl.innerHTML = list.map((s, i) => cardHTML(s, i, qClassOf, cheapestId, cheapestTag, animate)).join('');

  heroCount.textContent = cfg
    ? `${list.length} estaciones ${cfg.net} · con ${cfg.app} −${state.dto} ct`
    : `Tenerife · ${list.length} gasolineras con ${FUELS.find((f) => f.key === state.fuel).label}`;

  // F1 · sello de la más barata: marca la tarjeta nº1 tras el último escalón de entrada.
  // cheapestId ya respeta la lente de descuento (cheapestStation sobre la lista visible).
  clearTimeout(champTimer);
  const champ = cheapestId && listEl.querySelector(`.card[data-id="${cheapestId}"]`);
  if (champ) {
    if (!animate || reduced()) champ.classList.add('is-champion');
    else champTimer = setTimeout(() => champ.classList.add('is-champion'), Math.min(list.length - 1, 13) * 36 + 120);
  }
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
  renderPremiumTip();
  renderList(animate);
  renderUpdated();
}

// ---------- hoja de detalle ----------

function sheetHTML(s) {
  const st = scheduleStatus(s.schedule);
  const name = brandCase(s.brand);
  const myPrice = priceOf(s);
  const cfg = state.mode ? DISCOUNT_MODES[state.mode] : null;
  // con una app activa "la más barata" es dentro de su red; si no, de toda la isla
  const allAvail = stationsAvailable();
  const pool = cfg ? allAvail.filter(inMode) : allAvail;
  const cheapest = myPrice != null && pool.length > 0 && s.id === cheapestStation(pool).id;
  const cheapestLabel = cfg ? `La más barata con ${cfg.app}` : 'Mejor precio de la isla';

  const townLine = [shortTown(s.town), s._km != null ? `a ${formatKm(s._km)}` : null].filter(Boolean).join(' · ');

  const cells = FUELS.filter((f) => s.prices[f.key] != null).map((f) => `
    <div class="price-cell ${f.key === state.fuel ? 'selected' : ''}">
      <span class="price-cell-label">${f.full}</span>
      <span class="price-cell-value">${fmtPrice(s.prices[f.key])} €</span>
    </div>`).join('');

  const openSub = st
    ? (st.always ? 'Abierto 24 horas' : st.open ? `Abierto ahora${st.until ? ` · cierra a las ${st.until}` : ''}` : 'Cerrado ahora')
    : '';

  return `<div class="sheet-stagger">
    <div class="sheet-head">
      ${monoHTML(s, name)}
      <div>
        <div class="sheet-name">${name}</div>
        <div class="sheet-town">${townLine}</div>
        ${cheapest ? bestTagHTML(cheapestLabel) : ''}
      </div>
    </div>
    ${rangeMeter(myPrice, allAvail)}
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
      ${cfg && inMode(s) && priceOf(s) != null ? `<div class="sheet-row">
        <svg class="ilc" aria-hidden="true"><use href="#il-coin"/></svg>
        <span class="sheet-row-text">Con tu descuento ${cfg.app} de −${state.dto} ct
          <span class="sheet-row-sub">Te sale a ${fmtPrice(priceOf(s))} €/L (${cfg.note})</span>
        </span>
      </div>` : ''}
    </div>
    <div class="price-grid">${cells}</div>
    <div class="sheet-actions">
      <a class="action-btn primary" href="${googleMapsUrl(s.lat, s.lng)}" target="_blank" rel="noopener">
        <svg class="ic"><use href="#i-nav"/></svg> Cómo llegar
      </a>
    </div>
  </div>`;
}

// F2 · termómetro de rango: dónde cae el precio (efectivo) de esta estación dentro del
// rango de diésel de la isla. Percentil real sobre priceOf (respeta la lente de descuento).
function rangeMeter(price, pool) {
  const prices = pool.map(priceOf).filter((p) => p != null);
  if (price == null || prices.length < 2) return '';
  const min = Math.min(...prices), max = Math.max(...prices);
  const span = Math.max(0.001, max - min);
  const pct = Math.max(0, Math.min(1, (price - min) / span));
  const cheaperThan = Math.round(prices.filter((p) => p > price).length / prices.length * 100);
  const phrase = cheaperThan >= 50
    ? `Más barata que el <strong>${cheaperThan}%</strong> de Tenerife.`
    : `Más cara que el <strong>${100 - cheaperThan}%</strong> de Tenerife.`;
  return `<div class="meter">
    <div class="meter-track">
      <div class="meter-marker" style="left:${(pct * 100).toFixed(1)}%">
        <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 5C17 14 12 21 12 27.5 12 34.8 17.3 40.5 24 40.5S36 34.8 36 27.5C36 21 31 14 24 5Z" fill="currentColor"/></svg>
      </div>
    </div>
    <div class="meter-labels"><span class="lo">${eur(min)}</span><span class="hi">${eur(max)}</span></div>
    <div class="meter-phrase">${phrase}</div>
  </div>`;
}

function openStation(s) {
  openSheet(sheetHTML(s) + logFormHTML(s));
}

// ---------- registro de repostajes (localStorage) ----------

const LOG_KEY = 'db.log.v1';

function loadLog() {
  try { const a = JSON.parse(localStorage.getItem(LOG_KEY)); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function saveLog(arr) {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(arr)); } catch {}
}

const nfL = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0, useGrouping: true });

// formulario plegable al final de la ficha: "Registrar repostaje aquí"
function logFormHTML(s) {
  const price = priceOf(s);
  const fuelName = (FUELS.find((f) => f.key === state.fuel) || FUELS[0]).label;
  return `<div class="sheet-log" data-station="${s.id}" data-fuel="${state.fuel}" data-price="${price ?? ''}">
    <button class="log-open" type="button" data-log-open>
      <svg class="ic" aria-hidden="true"><use href="#il-coin"/></svg> He repostado aquí
    </button>
    <form class="log-form" hidden>
      <div class="log-fields">
        <label class="log-field">Litros
          <input class="log-liters" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0" autocomplete="off">
        </label>
        <label class="log-field">€ / litro (${fuelName})
          <input class="log-price" type="number" inputmode="decimal" min="0" step="0.001" value="${price != null ? price.toFixed(3) : ''}" autocomplete="off">
        </label>
      </div>
      <label class="log-field log-odo-field">
        <span>Kilómetros del coche <span class="log-opt">opcional · para el consumo</span></span>
        <input class="log-odo" type="number" inputmode="numeric" min="0" step="1" placeholder="Ej. 84500" autocomplete="off">
      </label>
      <div class="log-total">Total <strong>—</strong></div>
      <button class="log-save" type="submit" disabled>Guardar repostaje</button>
    </form>
  </div>`;
}

const pad2 = (n) => String(n).padStart(2, '0');

function startOfWeek(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // lunes como inicio
  return d;
}
function weekKey(ts) { const d = startOfWeek(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function weekLabel(k) {
  const [y, m, dd] = k.split('-').map(Number);
  const a = new Date(y, m - 1, dd), b = new Date(y, m - 1, dd + 6);
  const f = (d) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  return `${f(a)} – ${f(b)}`;
}
function monthKey(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
function monthLabel(k) {
  const [y, m] = k.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const PERIODS = {
  week:  { tab: 'Semana', key: weekKey,  label: weekLabel,                 cur: 'Esta semana', unit: 'semana' },
  month: { tab: 'Mes',    key: monthKey, label: monthLabel,                cur: 'Este mes',    unit: 'mes' },
  year:  { tab: 'Año',    key: (ts) => String(new Date(ts).getFullYear()), label: (k) => k, cur: 'Este año', unit: 'año' },
};
let logPeriod = 'month';

function renderLog() {
  const all = loadLog();
  if (!all.length) {
    logBody.innerHTML = `<div class="log-empty">
      <svg class="empty-ic" aria-hidden="true"><use href="#il-coin"/></svg>
      <p>Aún no has registrado ningún repostaje.</p>
      <p class="log-empty-sub">Cuando repostes, ábrelo desde la ficha de la gasolinera y pulsa “He repostado aquí”.</p>
    </div>`;
    return;
  }

  // consumo real (método lleno-a-lleno): emparejar repostajes con cuentakilómetros.
  // Cada tramo entre dos lecturas de km usa la gasolina repostada en ese tramo.
  const asc = [...all].sort((a, b) => a.ts - b.ts);
  let prevOdo = null, bucketL = 0, bucketC = 0, totDist = 0, totL = 0, totC = 0;
  const l100s = []; // F9: histórico de tramos para el color de la aguja del gauge
  for (const e of asc) {
    e._l100 = null;
    if (e.odo != null) {
      if (prevOdo != null && e.odo > prevOdo) {
        const dist = e.odo - prevOdo, fuel = bucketL + e.liters, cost = bucketC + e.total;
        e._l100 = (fuel / dist) * 100;
        totDist += dist; totL += fuel; totC += cost; l100s.push(e._l100);
      }
      prevOdo = e.odo; bucketL = 0; bucketC = 0;
    } else {
      bucketL += e.liters; bucketC += e.total;
    }
  }
  const hasConsumo = totDist > 0;
  const l100 = hasConsumo ? totL / totDist * 100 : 0;
  const log = asc.slice().reverse(); // descendente para mostrar, mismos objetos con _l100

  const P = PERIODS[logPeriod];
  const groups = new Map();
  for (const e of log) {
    const k = P.key(e.ts);
    if (!groups.has(k)) groups.set(k, { total: 0, liters: 0, n: 0 });
    const g = groups.get(k);
    g.total += e.total; g.liters += e.liters; g.n += 1;
  }
  const ordered = [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const maxTotal = Math.max(...ordered.map(([, g]) => g.total));
  const cur = ordered[0][1];
  const avg = ordered.reduce((s, [, g]) => s + g.total, 0) / ordered.length;

  const toggle = `<div class="log-period">${Object.entries(PERIODS).map(([k, p]) =>
    `<button class="log-period-btn" type="button" data-period="${k}" aria-pressed="${k === logPeriod}">${p.tab}</button>`).join('')}</div>`;

  const bars = ordered.map(([k, g]) => `
    <div class="log-month">
      <div class="log-month-top">
        <span class="log-month-name">${P.label(k)}</span>
        <span class="log-month-total">${nfEuro.format(g.total)} €</span>
      </div>
      <div class="log-bar"><span style="width:${Math.max(4, (g.total / maxTotal) * 100)}%"></span></div>
      <div class="log-month-sub">${nfL.format(g.liters)} L · ${g.n} repostaje${g.n > 1 ? 's' : ''} · ${nfPrice.format(g.total / g.liters)} €/L medio</div>
    </div>`).join('');

  const entryRows = log.map((e) => `
    <li class="log-entry">
      <div class="log-entry-main">
        <span class="log-entry-brand">${e.brand}</span>
        <span class="log-entry-meta">${new Date(e.ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} · ${nfL.format(e.liters)}${NB}L · ${nfPrice.format(e.price)}${NB}€/L${e._l100 ? ` · ${nfL.format(e._l100)}${NB}L/100${NB}km` : ''}</span>
      </div>
      <span class="log-entry-total">${nfEuro.format(e.total)} €</span>
      <button class="log-del" data-del="${e.id}" aria-label="Borrar repostaje">
        <svg class="ic" aria-hidden="true"><use href="#i-trash"/></svg>
      </button>
    </li>`).join('');

  // F9 · gauge cálido (estilo cuadro de mandos) en vez de la celda L/100 km
  const consumo = hasConsumo
    ? `<div class="log-section-title">Consumo real</div>
       <div class="log-consumo">
         <div class="gauge-cell">${gaugeHTML(l100, l100s)}
           <div class="gauge-side">
             <div class="log-consumo-val">${nfEuro.format(totC / totDist * 100)} €</div><div class="log-consumo-unit">por 100 km</div>
             <div class="log-consumo-val" style="margin-top:8px">${nf0.format(totDist)}</div><div class="log-consumo-unit">km medidos</div>
           </div>
         </div>
       </div>`
    : `<div class="log-hint">Apunta los km del cuentakilómetros al repostar y verás tu consumo real (L/100 km) y el coste por 100 km.</div>`;

  logBody.innerHTML = `
    ${toggle}
    <div class="log-summary">
      <span class="log-summary-label">${P.cur}</span>
      <span class="log-summary-total" id="logTotal">—</span>
      <span class="log-summary-sub">${nfL.format(cur.liters)}${NB}L · ${cur.n} repostaje${cur.n > 1 ? 's' : ''} · media ${nfEuro.format(avg)}${NB}€/${P.unit}</span>
    </div>
    ${consumo}
    ${sparkCardHTML(asc)}
    <div class="log-section-title">Por ${P.unit}</div>
    ${bars}
    <div class="log-section-title">Historial</div>
    <ul class="log-entries">${entryRows}</ul>`;

  // F3 · el total del periodo cuenta con el rodillo
  animateValue($('logTotal'), cur.total, (v) => `${nfEuro.format(v)} €`);
  // F9 aguja + F11 dibujo del sparkline (tras pintar)
  requestAnimationFrame(() => { animateGauge(); wireSpark(asc); });
}

// ▓ F9 · gauge de consumo (arco + aguja, color por cuartil del histórico propio) ▓
function gaugeArcPath(cx, cy, r, a0, a1) {
  const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  const large = (a1 - a0) > Math.PI ? 1 : 0;
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}
const GAUGE_MAX = 9, GA0 = Math.PI * 0.78, GA1 = Math.PI * 2.22; // ~220°
function gaugeHTML(value, history) {
  const cx = 60, cy = 60, r = 46;
  const full = gaugeArcPath(cx, cy, r, GA0, GA1);
  const ticks = [4, 7].map((v) => {
    const a = GA0 + (GA1 - GA0) * (v / GAUGE_MAX);
    const x1 = cx + (r - 9) * Math.cos(a), y1 = cy + (r - 9) * Math.sin(a);
    const x2 = cx + (r + 1) * Math.cos(a), y2 = cy + (r + 1) * Math.sin(a);
    const lx = cx + (r - 16) * Math.cos(a), ly = cy + (r - 16) * Math.sin(a);
    return `<line class="gauge-tick" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/><text class="gauge-ticklabel" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${v}</text>`;
  }).join('');
  const sorted = [...history].sort((a, b) => a - b);
  const qcol = (() => {
    if (sorted.length < 2) return 'var(--q1)';
    const rank = sorted.filter((x) => x < value).length / sorted.length;
    return rank <= 0.25 ? 'var(--q0)' : rank <= 0.5 ? 'var(--q1)' : rank <= 0.75 ? 'var(--q2)' : 'var(--q3)';
  })();
  return `<div class="gauge" data-value="${value}" data-needle="${qcol}">
    <svg viewBox="0 0 120 100" aria-hidden="true">
      <defs><linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="var(--q0)"/><stop offset="0.5" stop-color="var(--q1)"/><stop offset="1" stop-color="var(--q3)"/>
      </linearGradient></defs>
      <path class="gauge-arc-bg" d="${full}"/>
      <path class="gauge-arc" d="${full}"/>
      ${ticks}
      <line class="gauge-needle" x1="60" y1="60" x2="${(60 + (r - 6) * Math.cos(GA0)).toFixed(1)}" y2="${(60 + (r - 6) * Math.sin(GA0)).toFixed(1)}" stroke="${qcol}"/>
      <circle class="gauge-pivot" cx="60" cy="60" r="4.5"/>
    </svg>
    <div class="gauge-center"><span class="gauge-num">${nfL.format(value)}</span><span class="gauge-unit">L/100 km</span></div>
  </div>`;
}
function animateGauge() {
  const g = logBody.querySelector('.gauge');
  if (!g) return;
  const value = parseFloat(g.dataset.value);
  const arc = g.querySelector('.gauge-arc');
  const needle = g.querySelector('.gauge-needle');
  const len = arc.getTotalLength();
  const frac = Math.max(0, Math.min(1, value / GAUGE_MAX));
  const angleAt = (f) => GA0 + (GA1 - GA0) * f;
  const r = 40;
  const setNeedle = (f) => { const a = angleAt(f); needle.setAttribute('x2', (60 + r * Math.cos(a)).toFixed(1)); needle.setAttribute('y2', (60 + r * Math.sin(a)).toFixed(1)); };
  if (reduced()) { arc.style.strokeDasharray = `${len * frac} ${len}`; setNeedle(frac); return; }
  arc.style.strokeDasharray = `${len} ${len}`;
  arc.style.strokeDashoffset = String(len);
  arc.animate([{ strokeDashoffset: len }, { strokeDashoffset: len - len * frac }], { duration: 680, easing: 'cubic-bezier(0.32,0.72,0,1)', fill: 'forwards' });
  const t0 = performance.now(), dur = 680;
  const ease = (p) => 1 - (1 - p) ** 3;
  (function tick(t) {
    const p = Math.min(1, (t - t0) / dur);
    const overshoot = p > 0.85 ? 1 + Math.sin((p - 0.85) / 0.15 * Math.PI) * 0.04 : 1;
    setNeedle(frac * ease(p) * overshoot);
    if (p < 1) requestAnimationFrame(tick);
  })(t0);
}

// ▓ F11 · sparkline de €/L pagado con scrubbing y frase honesta ▓
function sparkCardHTML(asc) {
  if (asc.length < 2) return `<div class="spark-card"><div class="log-section-title">Lo que pagas por litro</div><p class="spark-phrase">Registra algún repostaje más y verás aquí cómo evoluciona tu €/L.</p></div>`;
  return `<div class="spark-card"><div class="log-section-title">Lo que pagas por litro</div><div class="spark-wrap" id="sparkWrap"></div></div>`;
}
function wireSpark(asc) {
  const wrap = $('sparkWrap');
  if (!wrap || asc.length < 2) return;
  const W = wrap.clientWidth || 300, H = 96, pad = 14;
  const prices = asc.map((e) => e.price);
  const min = Math.min(...prices), max = Math.max(...prices), span = Math.max(0.001, max - min);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const X = (i) => pad + (W - pad * 2 - 28) * (i / (asc.length - 1));
  const Y = (p) => pad + (H - pad * 2) * (1 - (p - min) / span);
  const sortedP = [...prices].sort((a, b) => a - b);
  const qOf = (p) => { const rank = sortedP.filter((x) => x < p).length / sortedP.length; return rank <= 0.25 ? 'q0' : rank <= 0.5 ? 'q1' : rank <= 0.75 ? 'q2' : 'q3'; };
  const pts = asc.map((e, i) => [X(i), Y(e.price)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const avgY = Y(avg).toFixed(1);
  const last = pts[pts.length - 1];
  const dots = asc.map((e, i) => `<circle class="spark-dot ${qOf(e.price)}" cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="${i === asc.length - 1 ? 4 : 2.6}" style="animation-delay:${i * 60 + 300}ms"/>`).join('');
  wrap.innerHTML = `<svg class="spark-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <line class="spark-avg" x1="${pad}" y1="${avgY}" x2="${W - 28}" y2="${avgY}"/>
    <path class="spark-line" d="${d}"/>${dots}
    <text class="spark-last-label" x="${(last[0] + 7).toFixed(1)}" y="${(last[1] + 4).toFixed(1)}">${nfPrice.format(asc[asc.length - 1].price)} €</text>
  </svg>
  <div class="spark-tip" id="sparkTip"></div>`;
  const line = wrap.querySelector('.spark-line');
  if (line) { const L = line.getTotalLength(); line.style.setProperty('--len', L); }
  if (asc.length >= 3) {
    const diff = (asc[asc.length - 1].price - asc[0].price) * 100;
    const phrase = document.createElement('div'); phrase.className = 'spark-phrase';
    phrase.innerHTML = diff <= 0
      ? `Tu €/L ha <strong>bajado ${nfL.format(Math.abs(diff))} ct</strong> desde tu primer repostaje.`
      : `Tu €/L ha <strong>subido ${nfL.format(diff)} ct</strong> desde tu primer repostaje.`;
    wrap.parentElement.appendChild(phrase);
  }
  const tip = $('sparkTip');
  const svg = wrap.querySelector('.spark-svg');
  function move(clientX) {
    const rect = svg.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width * W;
    let best = 0, bd = 1e9;
    pts.forEach((p, i) => { const dd = Math.abs(p[0] - x); if (dd < bd) { bd = dd; best = i; } });
    const e = asc[best];
    tip.innerHTML = `${new Date(e.ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} · ${e.brand} · <b>${nfPrice.format(e.price)} €</b>`;
    tip.style.left = (pts[best][0] / W * rect.width) + 'px';
    tip.style.top = (pts[best][1] / H * rect.height - 8) + 'px';
    tip.classList.add('show');
  }
  svg.addEventListener('pointerdown', (ev) => move(ev.clientX));
  svg.addEventListener('pointermove', (ev) => { if (ev.buttons || ev.pointerType === 'touch') move(ev.clientX); });
  svg.addEventListener('pointerup', () => tip.classList.remove('show'));
  svg.addEventListener('pointerleave', () => tip.classList.remove('show'));
}

listEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-id]');
  if (!btn) return;
  const s = state.stations.find((x) => x.id === btn.dataset.id);
  if (s) openStation(s);
});

// F19 · press de dos tiempos: la cifra se hunde un poco al pulsar; barrido cálido al soltar.
listEl.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('.card-btn');
  if (btn) btn.classList.add('pressing');
});
function releaseCard(e) {
  const btn = e.target.closest ? e.target.closest('.card-btn') : null;
  listEl.querySelectorAll('.card-btn.pressing').forEach((b) => {
    b.classList.remove('pressing');
    if (b === btn && !reduced()) { const sw = b.querySelector('.sweep'); if (sw) { sw.classList.remove('go'); void sw.offsetWidth; sw.classList.add('go'); } }
  });
}
listEl.addEventListener('pointerup', releaseCard);
listEl.addEventListener('pointercancel', releaseCard);
listEl.addEventListener('pointerleave', (e) => { const b = e.target.closest && e.target.closest('.card-btn'); if (b) b.classList.remove('pressing'); }, true);

// veredicto y consejo premium: tocar un enlace con data-id abre esa ficha
const openFromLink = (e) => {
  const btn = e.target.closest('[data-id]');
  if (!btn) return;
  const s = state.stations.find((x) => x.id === btn.dataset.id);
  if (s) openStation(s);
};
verdictEl.addEventListener('click', openFromLink);
premiumTip.addEventListener('click', openFromLink);

// ---------- formulario de repostaje dentro de la ficha ----------

sheetBody.addEventListener('click', (e) => {
  const open = e.target.closest('[data-log-open]');
  if (!open) return;
  const form = open.parentElement.querySelector('.log-form');
  open.hidden = true;
  form.hidden = false;
  form.querySelector('.log-liters').focus();
});

function logTotal(form) {
  const l = parseFloat(form.querySelector('.log-liters').value);
  const p = parseFloat(form.querySelector('.log-price').value);
  return Number.isFinite(l) && Number.isFinite(p) && l > 0 && p > 0 ? l * p : null;
}

sheetBody.addEventListener('input', (e) => {
  const form = e.target.closest('.log-form');
  if (!form) return;
  const t = logTotal(form);
  form.querySelector('.log-total strong').textContent = t != null ? `${nfEuro.format(t)} €` : '—';
  form.querySelector('.log-save').disabled = t == null;
});

sheetBody.addEventListener('submit', (e) => {
  const form = e.target.closest('.log-form');
  if (!form) return;
  e.preventDefault();
  const wrap = form.closest('.sheet-log');
  const t = logTotal(form);
  if (t == null) return;
  const s = state.stations.find((x) => x.id === wrap.dataset.station);
  const liters = parseFloat(form.querySelector('.log-liters').value);
  const price = parseFloat(form.querySelector('.log-price').value);
  const odoRaw = parseFloat(form.querySelector('.log-odo').value);
  const odo = Number.isFinite(odoRaw) && odoRaw > 0 ? odoRaw : null;
  const entry = {
    id: `${Date.now()}-${Math.round(liters * 100)}-${Math.random().toString(36).slice(2, 7)}`,
    ts: Date.now(),
    stationId: wrap.dataset.station,
    brand: s ? brandCase(s.brand) : 'Gasolinera',
    town: s ? shortTown(s.town) : '',
    fuel: wrap.dataset.fuel,
    liters,
    price,
    total: t,
    odo,
  };
  saveLog([entry, ...loadLog()]);
  saveReward(form, price); // F10 · recompensa honesta al guardar
});

// F10 · al guardar: gotita en el botón, y toast con veredicto honesto vs tu media previa.
function saveReward(form, price) {
  const log = loadLog();
  const prices = log.map((e) => e.price);
  const avg = prices.length > 1 ? prices.slice(1).reduce((a, b) => a + b, 0) / (prices.length - 1) : null;
  const btn = form.querySelector('.log-save');
  if (!reduced() && btn) {
    const drop = document.createElement('span');
    drop.className = 'save-drop';
    drop.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3c-3.5 4.6-5.5 7.5-5.5 10.2a5.5 5.5 0 0 0 11 0C17.5 10.5 15.5 7.6 12 3Z" fill="currentColor"/></svg>';
    btn.appendChild(drop);
    drop.animate([
      { transform: 'translateY(-22px) scaleY(1.1)', opacity: 0 },
      { transform: 'translateY(0) scaleY(1)', opacity: 1, offset: 0.55 },
      { transform: 'translateY(0) scaleX(1.4) scaleY(0.7)', opacity: 1, offset: 0.7 },
      { transform: 'translateY(0) scale(1)', opacity: 0 },
    ], { duration: 600, easing: 'cubic-bezier(0.34,1.4,0.64,1)' }).onfinish = () => drop.remove();
  }
  setTimeout(() => {
    closeSheet();
    let verdict = '';
    if (avg != null) {
      const diff = price - avg;
      const below = diff <= 0;
      const mark = below ? '<svg class="vmark" viewBox="0 0 24 24"><path d="M5 13l4 4 10-11"/></svg>' : '<svg class="vmark" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      verdict = `<div class="toast-verdict ${below ? 'below' : 'above'}">${mark}${nfPrice.format(Math.abs(diff))} €/L ${below ? 'por debajo' : 'por encima'} de tu media</div>`;
    }
    toast(`Repostaje guardado · ${nfEuro.format(loadLog()[0].total)} €`, verdict);
    const g = gastosBtn; // F10 · pulso del botón de gastos
    if (!reduced() && g) { g.classList.remove('pulse'); void g.offsetWidth; g.classList.add('pulse'); }
  }, reduced() ? 0 : 280);
}

// ---------- vista de gastos ----------

let logLastFocus = null;

gastosBtn.addEventListener('click', () => {
  renderLog();
  logLastFocus = document.activeElement;
  logView.hidden = false;
  mainEl.inert = true; // el fondo deja de recibir foco/toques mientras está el overlay
  logClose.focus({ preventScroll: true });
});

function closeLog() {
  if (logView.hidden) return;
  mainEl.inert = false;
  logView.classList.add('closing');
  setTimeout(() => { logView.hidden = true; logView.classList.remove('closing'); }, 300);
  if (logLastFocus && logLastFocus.focus) logLastFocus.focus({ preventScroll: true });
  logLastFocus = null;
}

logClose.addEventListener('click', closeLog);

logBody.addEventListener('click', (e) => {
  const per = e.target.closest('[data-period]');
  if (per) { logPeriod = per.dataset.period; renderLog(); return; }
  const del = e.target.closest('[data-del]');
  if (del) {
    saveLog(loadLog().filter((x) => x.id !== del.dataset.del));
    renderLog();
  }
});

// ---------- toast ----------

let toastTimer = null;

// 2º parámetro opcional: HTML de una segunda línea (p. ej. el veredicto €/L de F10).
function toast(msg, html2 = '') {
  toastEl.innerHTML = `<div>${msg}</div>${html2}`;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), html2 ? 3400 : 2600);
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
  if (state.mapOpen) updatePins(mapArgs()); // mapa coherente con el combustible elegido
});

// apps de descuento: tocar una la activa (lente sobre el combustible actual);
// tocar la activa otra vez la desactiva → vuelve al modo normal
function setMode(mode) {
  state.mode = mode;
  [...appsRow.querySelectorAll('[data-mode]')].forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  if (mode) {
    const cfg = DISCOUNT_MODES[mode];
    state.dto = cfg.tiers[0];
    const btns = dtoSeg.querySelectorAll('.seg-btn');
    cfg.tiers.forEach((t, i) => { btns[i].dataset.dto = String(t); btns[i].textContent = `−${t} ct`; });
    setSeg(dtoSeg, 'dto', String(state.dto));
  }
  dtoRow.hidden = !mode;
  renderAll(true);
  if (state.mapOpen) updatePins(mapArgs());
}

appsRow.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-mode]');
  if (!btn) return;
  setMode(state.mode === btn.dataset.mode ? null : btn.dataset.mode);
});

dtoSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-dto]');
  if (!btn || +btn.dataset.dto === state.dto) return;
  state.dto = +btn.dataset.dto;
  setSeg(dtoSeg, 'dto', String(state.dto));
  renderAll(false); // comparación instantánea: sin re-animar la lista entera
  if (state.mapOpen) updatePins(mapArgs());
});

// F5 · reflujo FLIP: anima el reordenamiento midiendo posiciones de cada tarjeta (por id)
// antes y después del re-render. Solo toca transform; el resto de renderAll no se ve afectado.
function flipReorder(mutate) {
  if (reduced()) { mutate(); return; }
  const before = new Map();
  listEl.querySelectorAll('.card').forEach((c) => before.set(c.dataset.id, c.getBoundingClientRect().top));
  mutate();
  listEl.querySelectorAll('.card').forEach((c) => {
    const oldTop = before.get(c.dataset.id);
    if (oldTop == null) return;
    const delta = oldTop - c.getBoundingClientRect().top;
    if (!delta) return;
    const travel = Math.min(1, Math.abs(delta) / 600);
    c.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }],
      { duration: 420, delay: travel * 18, easing: 'cubic-bezier(0.32,0.72,0,1)' });
  });
  const topMono = listEl.querySelector('.card .mono'); // mono-pop de la que asciende al top
  if (topMono) { topMono.classList.remove('is-popping'); void topMono.offsetWidth; topMono.classList.add('is-popping'); }
}

sortSeg.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-sort]');
  if (!btn || btn.dataset.sort === state.sort) return;

  if (btn.dataset.sort === 'near' && !state.pos) {
    setSeg(sortSeg, 'sort', 'near');
    try {
      state.pos = await requestPosition();
      flipReorder(() => { computeDistances(); state.sort = 'near'; renderAll(false); });
    } catch {
      setSeg(sortSeg, 'sort', state.sort);
      toast('No se pudo acceder a tu ubicación');
    }
    return;
  }
  state.sort = btn.dataset.sort;
  setSeg(sortSeg, 'sort', state.sort);
  flipReorder(() => renderAll(false)); // FLIP en vez de re-animar 200 tarjetas
});

// ---------- mapa ----------

function mapArgs() {
  // mapa coherente con la lista: con una app activa, solo sus pines
  const stations = state.mode ? state.stations.filter(inMode) : state.stations;
  return {
    stations,
    priceOf,
    qClassOf: makeQClass(stations), // mismos colores que la lista (relativo a lo visible)
    fmtPrice,
    onSelect: openStation,
  };
}

let mapLastFocus = null;

mapBtn.addEventListener('click', async () => {
  state.mapOpen = true;
  mapLastFocus = document.activeElement;
  mapView.hidden = false;
  mainEl.inert = true;
  try {
    await showMap({ ...mapArgs(), pos: state.pos });
    mapClose.focus({ preventScroll: true });
  } catch {
    mapView.hidden = true;
    mainEl.inert = false;
    state.mapOpen = false;
    if (mapLastFocus && mapLastFocus.focus) mapLastFocus.focus({ preventScroll: true });
    toast('No se pudo cargar el mapa');
  }
});

function closeMap() {
  if (mapView.hidden) return;
  closeSheet();
  mainEl.inert = false;
  mapView.classList.add('closing');
  setTimeout(() => {
    mapView.hidden = true;
    mapView.classList.remove('closing');
    state.mapOpen = false;
  }, 300); // = duración de map-out
  if (mapLastFocus && mapLastFocus.focus) mapLastFocus.focus({ preventScroll: true });
  mapLastFocus = null;
}

mapClose.addEventListener('click', closeMap);

// Escape cierra los overlays de pantalla completa (la ficha ya tiene el suyo en sheet.js).
// En captura para correr ANTES del handler de la ficha: si hay una ficha abierta encima
// (p. ej. desde un pin del mapa), salimos y dejamos que Escape cierre solo la ficha, no el mapa.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || document.querySelector('.sheet.open')) return;
  if (!logView.hidden) closeLog();
  else if (!mapView.hidden) closeMap();
}, true);

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

// al volver a la app tras un rato, refrescar en silencio + actualizar la franja del día (F12)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  applyDaytime();
  if (state.fecha && Date.now() - state.fecha > 10 * 60 * 1000) refresh({ silent: true });
});

// ---------- barra compacta al hacer scroll ----------
// F6 · la topbar cuaja como vidrio: --t (0→1) controla opacidad/blur/fondo y la migración
// de la cifra; --chip-t muestra el chip de actualizar más tarde. F13 · --sy alimenta el parallax.

const hero = document.querySelector('.hero');
const heroEl = document.querySelector('.hero-art');
topbar.classList.add('scroll-driven');
let ticking = false;

// F12 · el Teide según la hora real (recolorea el cielo del hero por franja del día)
function applyDaytime() {
  if (!heroEl) return;
  const h = new Date().getHours();
  heroEl.setAttribute('data-daytime', h < 8 ? 'dawn' : h < 18 ? 'day' : h < 21 ? 'dusk' : 'night');
}

function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    const y = window.scrollY;
    const t = Math.max(0, Math.min(1, (y - (hero.offsetHeight - 90)) / 80));
    document.documentElement.style.setProperty('--t', t.toFixed(3));
    document.documentElement.style.setProperty('--chip-t', t > 0.6 ? '1' : '0');
    topbar.setAttribute('data-shown', String(t > 0.02));
    hero.style.setProperty('--sy', String(y)); // F13 parallax
    ticking = false;
  });
}

window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

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
  // arranca sin app de descuento activa (modo normal)
  applyDaytime(); // F12
  setSeg(fuelSeg, 'fuel', state.fuel);
  setSeg(sortSeg, 'sort', state.sort);

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
