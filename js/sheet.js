// Bottom sheet arrastrable con física tipo iOS.
// F7 · cierre/snap con momentum (WAAPI).  F8 · el fondo se aleja y desenfoca.

const sheet = document.getElementById('sheet');
const backdrop = document.getElementById('sheetBackdrop');
const body = document.getElementById('sheetBody');
const mainEl = document.getElementById('main'); // F8: fondo que se aleja/desenfoca

let isOpen = false;
let drag = null;
let lastFocused = null;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// cerrada al arrancar: que el teclado/lector no alcance sus enlaces fuera de pantalla
sheet.inert = true;
sheet.tabIndex = -1;

function currentSheetY() {
  const m = /translateY\(([-\d.]+)px\)/.exec(sheet.style.transform || '');
  return m ? parseFloat(m[1]) : 0;
}

export function openSheet(html) {
  body.innerHTML = html;
  body.scrollTop = 0;
  lastFocused = document.activeElement;
  backdrop.hidden = false;
  sheet.inert = false;
  // forzar reflow para que la transición arranque desde el estado oculto
  void sheet.offsetHeight;
  backdrop.classList.add('show');
  sheet.classList.add('open');
  isOpen = true;
  // F8 · el fondo se aleja y desenfoca mientras la ficha está abierta
  if (mainEl) { mainEl.classList.add('sheet-depth'); mainEl.style.setProperty('--sheet-p', '1'); }
  // F8 · entrada escalonada del contenido
  body.querySelectorAll('.sheet-stagger > *').forEach((r, i) => r.style.setProperty('--si', i));
  // F2 · el marcador del termómetro se desliza desde lo más barato hasta su sitio
  const marker = body.querySelector('.meter-marker');
  if (marker && !reduced()) {
    const target = marker.style.left;
    marker.style.left = '0%';
    requestAnimationFrame(() => requestAnimationFrame(() => { marker.style.left = target; }));
  }
  sheet.focus({ preventScroll: true });
}

export function closeSheet() {
  if (!isOpen) return;
  isOpen = false;
  // teclado: devolver la ficha a su sitio
  sheet.classList.remove('kb');
  sheet.style.removeProperty('--kb');
  // F8 · devolver el fondo a su sitio (y quitar la clase cuando termine la transición)
  if (mainEl) { mainEl.style.setProperty('--sheet-p', '0'); setTimeout(() => { if (!isOpen) mainEl.classList.remove('sheet-depth'); }, 430); }
  // F7 · cierre con momentum; con reduce-motion, cierre simple por CSS
  if (reduced()) {
    sheet.classList.remove('open');
    sheet.style.transform = '';
  } else {
    const h = sheet.offsetHeight || 600;
    const startY = currentSheetY();
    sheet.classList.remove('dragging');
    const a = sheet.animate(
      [{ transform: `translateY(${startY}px)` }, { transform: `translateY(${h + 40}px)` }],
      { duration: 360, easing: 'cubic-bezier(0.32,0.72,0,1)', fill: 'forwards' });
    a.onfinish = () => { sheet.classList.remove('open'); sheet.style.transform = ''; sheet.getAnimations().forEach((x) => x.cancel()); };
  }
  sheet.inert = true;
  backdrop.classList.remove('show');
  setTimeout(() => { if (!isOpen) backdrop.hidden = true; }, 400);
  // devolver el foco a la tarjeta que abrió la hoja
  if (lastFocused && lastFocused.focus) lastFocused.focus({ preventScroll: true });
  lastFocused = null;
}

backdrop.addEventListener('click', closeSheet);

// Arrastre: desde el asa siempre; desde el cuerpo solo si está arriba del todo.
sheet.addEventListener('touchstart', (e) => {
  if (!isOpen) return;
  const fromGrip = e.target.closest('.sheet-grip, .sheet-head');
  if (!fromGrip && body.scrollTop > 0) return;
  sheet.classList.add('gripping'); // F7: el asa reacciona al tacto
  drag = { startY: e.touches[0].clientY, dy: 0, lastY: e.touches[0].clientY, lastT: e.timeStamp, vy: 0, fromGrip: !!fromGrip };
}, { passive: true });

sheet.addEventListener('touchmove', (e) => {
  if (!drag) return;
  const y = e.touches[0].clientY;
  let dy = y - drag.startY;
  if (dy < 0) dy = dy / 8; // resistencia hacia arriba
  const dt = Math.max(1, e.timeStamp - drag.lastT);
  drag.vy = (y - drag.lastY) / dt;
  drag.lastY = y;
  drag.lastT = e.timeStamp;
  drag.dy = dy;
  if (dy > 0 && !drag.fromGrip && body.scrollTop > 0) { drag = null; sheet.style.transform = ''; return; }
  sheet.classList.add('dragging');
  if (mainEl) mainEl.classList.add('dragging-depth');
  sheet.style.transform = `translateY(${Math.max(dy, -30)}px)`;
  const h = sheet.offsetHeight;
  backdrop.style.opacity = String(Math.max(0, 1 - dy / h));
  if (mainEl) mainEl.style.setProperty('--sheet-p', String(Math.max(0, 1 - dy / h))); // F8: el fondo vuelve al arrastrar
}, { passive: true });

sheet.addEventListener('touchend', () => {
  sheet.classList.remove('gripping');
  if (!drag) return;
  sheet.classList.remove('dragging');
  if (mainEl) mainEl.classList.remove('dragging-depth');
  backdrop.style.opacity = '';
  const h = sheet.offsetHeight;
  const shouldClose = drag.dy > h * 0.35 || drag.vy > 0.55;
  const vy = drag.vy;
  drag = null;
  if (shouldClose) { closeSheet(); return; }
  if (mainEl) mainEl.style.setProperty('--sheet-p', '1');
  // F7 · snap-back con muelle proporcional a la velocidad de arrastre
  if (reduced()) { sheet.style.transform = ''; return; }
  const startY = currentSheetY();
  const energy = Math.min(1, Math.abs(vy) / 0.8);
  const over = 6 + energy * 14; // soltar rápido = rebote más vivo
  sheet.animate(
    [{ transform: `translateY(${startY}px)` }, { transform: `translateY(${-over}px)`, offset: 0.55 }, { transform: 'translateY(0)' }],
    { duration: 480, easing: 'cubic-bezier(0.2,0.9,0.25,1.1)' }
  ).onfinish = () => { sheet.style.transform = ''; };
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
});

// ---------- teclado en iPhone ----------
// Al enfocar un campo (litros/precio/km), el teclado de iOS tapa la parte baja
// de la ficha. Con visualViewport medimos su alto y subimos la ficha por encima,
// y desplazamos el campo enfocado a la vista. Sin visualViewport (escritorio),
// no molesta.
const vv = window.visualViewport;

function kbHeight() {
  if (!vv) return 0;
  return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
}

function syncKeyboard() {
  const focused = document.activeElement;
  const editing = isOpen && focused && sheet.contains(focused) &&
    /^(input|textarea)$/i.test(focused.tagName);
  const kb = kbHeight();
  if (editing && kb > 90) {
    sheet.style.setProperty('--kb', kb + 'px');
    sheet.classList.add('kb');
  } else {
    sheet.classList.remove('kb');
    sheet.style.removeProperty('--kb');
  }
}

if (vv) {
  vv.addEventListener('resize', syncKeyboard);
  vv.addEventListener('scroll', syncKeyboard);
}

sheet.addEventListener('focusin', (e) => {
  if (!/^(input|textarea)$/i.test(e.target.tagName)) return;
  // el teclado tarda en animar: recalcular y traer el campo a la vista
  setTimeout(syncKeyboard, 250);
  setTimeout(() => {
    syncKeyboard();
    e.target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 350);
});

sheet.addEventListener('focusout', () => {
  setTimeout(syncKeyboard, 120);
});
