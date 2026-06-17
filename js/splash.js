// Splash de entrada: orquesta la animación y elimina el overlay del DOM.
// No bloquea la carga de datos, se puede saltar tocando la pantalla.
(function () {
  'use strict';

  var splash = document.getElementById('splash');
  if (!splash) return;

  var reduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var SHOW_MS = reduced ? 450 : 1360;  // cuándo arranca la salida
  var EXIT_MS = reduced ? 320 : 520;   // failsafe tras la salida
  var leaving = false;

  function removeSplash() {
    if (splash && splash.parentNode) splash.parentNode.removeChild(splash);
    splash = null;
  }

  function leave() {
    if (leaving || !splash) return;
    leaving = true;
    clearTimeout(timer);

    var done = function (e) {
      if (e.target === splash) removeSplash();
    };
    splash.addEventListener('animationend', done);
    splash.addEventListener('transitionend', done);

    // failsafe: fuera del DOM pase lo que pase
    setTimeout(removeSplash, EXIT_MS + 200);

    // F15 · el splash entrega el paisaje al hero: hero y stats entran escalonados al salir
    // (las tarjetas ya cascadean solas con .enter, no se re-animan para no duplicar).
    if (!reduced) {
      var seq = [document.querySelector('.hero'), document.getElementById('stats')];
      for (var i = 0; i < seq.length; i++) {
        if (!seq[i]) continue;
        (function (el, k) {
          el.style.animation = 'card-in 0.55s var(--ease-ios) ' + (k * 80 + 60) + 'ms both';
          setTimeout(function () { el.style.animation = ''; }, k * 80 + 900);
        })(seq[i], i);
      }
    }

    splash.classList.add('is-leaving');
  }

  var timer = setTimeout(leave, SHOW_MS);

  // tocar la pantalla = saltar
  splash.addEventListener('pointerdown', leave, { passive: true });
})();
