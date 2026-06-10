// Bottom sheet arrastrable con física tipo iOS.

const sheet = document.getElementById('sheet');
const backdrop = document.getElementById('sheetBackdrop');
const body = document.getElementById('sheetBody');

let isOpen = false;
let drag = null;

export function openSheet(html) {
  body.innerHTML = html;
  body.scrollTop = 0;
  backdrop.hidden = false;
  // forzar reflow para que la transición arranque desde el estado oculto
  void sheet.offsetHeight;
  backdrop.classList.add('show');
  sheet.classList.add('open');
  isOpen = true;
}

export function closeSheet() {
  if (!isOpen) return;
  isOpen = false;
  sheet.classList.remove('open');
  sheet.style.transform = '';
  backdrop.classList.remove('show');
  setTimeout(() => { if (!isOpen) backdrop.hidden = true; }, 400);
}

backdrop.addEventListener('click', closeSheet);

// Arrastre: desde el asa siempre; desde el cuerpo solo si está arriba del todo.
sheet.addEventListener('touchstart', (e) => {
  if (!isOpen) return;
  const fromGrip = e.target.closest('.sheet-grip, .sheet-head');
  if (!fromGrip && body.scrollTop > 0) return;
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
  sheet.style.transform = `translateY(${Math.max(dy, -30)}px)`;
  backdrop.style.opacity = String(Math.max(0, 1 - dy / sheet.offsetHeight));
}, { passive: true });

sheet.addEventListener('touchend', () => {
  if (!drag) return;
  sheet.classList.remove('dragging');
  backdrop.style.opacity = '';
  const shouldClose = drag.dy > sheet.offsetHeight * 0.35 || drag.vy > 0.55;
  drag = null;
  if (shouldClose) {
    closeSheet();
  } else {
    sheet.style.transform = '';
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
});
