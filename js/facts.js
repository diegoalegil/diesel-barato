// Datos reales de cada marca de gasolinera presente en Tenerife.
// Cada texto es un dato verificable (origen de la empresa, si es canaria,
// calidad, low-cost, app de descuento…). Investigado con fuentes; los que no
// se pudieron confirmar se redactan de forma modesta y sin afirmar de más.
// Las claves coinciden con brandKey() de app.js.

export const BRAND_FACTS = {
  // — cadenas grandes (dato con fuente) —
  disa:      'DISA es canaria: nació en Santa Cruz de Tenerife en 1933 y hoy es la energética líder del archipiélago.',
  repsol:    'Repsol, heredera de la histórica CAMPSA, es la mayor petrolera de España; ahorras por litro pagando con su app Waylet.',
  bp:        'BP es una de las mayores petroleras del mundo, de origen británico; su gama Ultimate promete ir limpiando el motor.',
  cepsa:     'Cepsa levantó en 1930, en Santa Cruz de Tenerife, la primera refinería de petróleo de España.',
  shell:     'En Canarias las gasolineras Shell las gestiona DISA, el grupo canario nacido en Tenerife.',
  tgas:      'Tgas es una cadena 100% canaria (Petróleos Archipiélago), nacida en 2010.',
  moeve:     'Moeve es el nuevo nombre de Cepsa desde 2024; durante el cambio de marca verás los dos rótulos.',
  pcan:      'PCan (Petrolífera Canaria) nació en Santa Cruz de Tenerife en 1992, con capital 100% canario.',
  oceano:    'Océano es una operadora canaria independiente.',
  plenergy:  'Plenergy (antes Plenoil) es una cadena low cost española de 2015: estaciones automáticas y desatendidas para bajar el precio.',
  petroprix: 'Petroprix es una cadena low cost española de gasolineras automáticas, pensadas para dar el precio más bajo.',

  // — operadoras pequeñas / independientes (dato modesto y cierto) —
  gmoil:       'GM Oil es una operadora independiente de bajo coste.',
  canaryoil:   'Canary Oil es una operadora local canaria.',
  redcanarios: 'Red de Combustibles Canarios agrupa estaciones independientes del archipiélago.',
};

// Marcas «low cost» automáticas: suelen dar el precio más ajustado.
export const LOWCOST = new Set(['petroprix', 'plenergy', 'gmoil']);

// Devuelve el dato de marca para una brandKey, o null si no hay.
export function brandFact(key) {
  return BRAND_FACTS[key] || null;
}
