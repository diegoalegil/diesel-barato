// visual-check.mjs — bucle de verificación visual con Playwright
// Uso:    node visual-check.mjs [baseURL]
// Setup (una vez):  npm i -D playwright  &&  npx playwright install chromium
//
// Captura la app en varios viewports para auditarla visualmente.
// Lo único que se cambia por proyecto es el bloque CONFIG.
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'fs';

// ════════════════════════════════════════════════
//  CONFIG — lo único que cambias por proyecto
// ════════════════════════════════════════════════
const CONFIG = {
  baseURL: process.argv[2] || 'http://localhost:8741',
  routes: [
    { name: 'home', path: '' },   // es una sola página
  ],
  viewports: [
    { name: 'iphone-14',  width: 390, height: 844 },
    { name: 'iphone-max', width: 430, height: 932 },
    { name: 'desktop',    width: 1280, height: 800 },
  ],
  geolocation: { latitude: 28.34, longitude: -16.65 }, // norte de Tenerife → ordena por cercanía real
  waitUntil: 'domcontentloaded',  // la API + Leaflet hacen fetch continuo; networkidle no llega
  extraWaitMs: 2500,              // espera a que carguen teselas del mapa y precios
  autoScroll: true,  // dispara los loading="lazy" de los 200 logos antes de capturar
  fullPage: true,
};
// ════════════════════════════════════════════════

async function autoScroll(page) {
  await page.evaluate(() => new Promise((resolve) => {
    let y = 0;
    const id = setInterval(() => {
      window.scrollBy(0, 500);
      y += 500;
      if (y >= document.body.scrollHeight) {
        clearInterval(id);
        window.scrollTo(0, 0);
        resolve();
      }
    }, 80);
  }));
  await page.waitForTimeout(400);
}

const base = CONFIG.baseURL.endsWith('/') ? CONFIG.baseURL : CONFIG.baseURL + '/';

rmSync('shots', { recursive: true, force: true });
mkdirSync('shots', { recursive: true });

const browser = await chromium.launch();
const ctxOpts = {};
if (CONFIG.geolocation) {
  ctxOpts.geolocation = CONFIG.geolocation;
  ctxOpts.permissions = ['geolocation'];
}
const context = await browser.newContext(ctxOpts);

for (const vp of CONFIG.viewports) {
  const page = await context.newPage();
  await page.setViewportSize({ width: vp.width, height: vp.height });
  for (const route of CONFIG.routes) {
    const url = new URL(route.path.replace(/^\//, ''), base).href;
    try {
      await page.goto(url, { waitUntil: CONFIG.waitUntil, timeout: 30000 });
    } catch { /* seguimos aunque networkidle no llegue a estabilizarse */ }
    // primero esperar a que la app pinte (API, mapas…), DESPUÉS hacer scroll:
    // si se scrollea sobre el esqueleto, los loading="lazy" profundos no cargan
    if (CONFIG.extraWaitMs) await page.waitForTimeout(CONFIG.extraWaitMs);
    if (CONFIG.autoScroll) {
      await autoScroll(page);
      await page.waitForTimeout(800); // settle: que terminen de decodificar las imágenes
    }
    await page.screenshot({
      path: `shots/${route.name}-${vp.name}.png`,
      fullPage: CONFIG.fullPage,
    });
    console.log(`  ✓ ${route.name}-${vp.name}`);
  }
  await page.close();
}

await browser.close();
console.log('\n✓ Listo. Capturas en ./shots');
