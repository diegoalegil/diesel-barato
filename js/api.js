// Datos oficiales del Ministerio para la Transición Ecológica.
// Provincia 38 = Santa Cruz de Tenerife (incluye otras islas → se filtra Tenerife).

const API_URL =
  'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/FiltroProvincia/38';

const CACHE_KEY = 'db.cache.v1';

// Tenerife queda al este de este meridiano; La Gomera, La Palma y El Hierro al oeste.
const TENERIFE_MIN_LNG = -17.03;

// solo diésel (Diego no usa gasolina); el premium = Gasóleo Premium con aditivos
export const FUELS = [
  { key: 'diesel',     label: 'Diésel',  full: 'Diésel (Gasóleo A)', api: 'Precio Gasoleo A' },
  { key: 'dieselPlus', label: 'Premium', full: 'Diésel Premium',     api: 'Precio Gasoleo Premium' },
];

function num(s) {
  if (!s) return null;
  const n = parseFloat(String(s).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseFecha(s) {
  const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).getTime();
}

function normalize(e) {
  const lat = num(e['Latitud']);
  const lng = num(e['Longitud (WGS84)']) ?? parseFloat(String(e['Longitud (WGS84)'] || '').replace(',', '.'));
  const prices = {};
  for (const f of FUELS) prices[f.key] = num(e[f.api]);
  return {
    id: e['IDEESS'],
    brand: e['Rótulo'] || 'Gasolinera',
    address: e['Dirección'] || '',
    town: e['Municipio'] || '',
    locality: e['Localidad'] || '',
    schedule: e['Horario'] || '',
    lat,
    lng,
    prices,
    saleType: e['Tipo Venta'],
  };
}

function isTenerifePublic(s) {
  return (
    s.saleType === 'P' &&
    Number.isFinite(s.lat) && Number.isFinite(s.lng) &&
    s.lng > TENERIFE_MIN_LNG &&
    Object.values(s.prices).some((p) => p !== null)
  );
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return Array.isArray(data.stations) && data.stations.length ? data : null;
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch { /* almacenamiento lleno o bloqueado: no pasa nada */ }
}

export async function loadStations() {
  try {
    const res = await fetch(API_URL, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const stations = (json.ListaEESSPrecio || []).map(normalize).filter(isTenerifePublic);
    if (!stations.length) throw new Error('respuesta vacía');
    const data = {
      stations,
      fecha: parseFecha(json.Fecha) ?? Date.now(),
      fetchedAt: Date.now(),
    };
    writeCache(data);
    return { ...data, fromCache: false };
  } catch (err) {
    const cached = readCache();
    if (cached) return { ...cached, fromCache: true };
    throw err;
  }
}
