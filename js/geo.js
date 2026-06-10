// Geolocalización, distancias y enlaces de navegación.

const GEO_FLAG = 'db.geo.granted';

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function formatKm(km) {
  if (km == null) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}

export function requestPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('sin geolocalización'));
    navigator.geolocation.getCurrentPosition(
      (p) => {
        try { localStorage.setItem(GEO_FLAG, '1'); } catch {}
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude });
      },
      (err) => {
        try { localStorage.removeItem(GEO_FLAG); } catch {}
        reject(err);
      },
      { enableHighAccuracy: false, timeout: 9000, maximumAge: 300000 }
    );
  });
}

export function wasGranted() {
  try { return localStorage.getItem(GEO_FLAG) === '1'; } catch { return false; }
}

export function appleMapsUrl(lat, lng, name) {
  const q = encodeURIComponent(name || 'Gasolinera');
  return `https://maps.apple.com/?daddr=${lat},${lng}&q=${q}&dirflg=d`;
}

export function googleMapsUrl(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}
