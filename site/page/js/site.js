// TeensyROM Suite product page. Progressive only: the page reads fully without this file.
(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.add('js');

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasObserver = 'IntersectionObserver' in window;

  // ---------- scroll reveal (below-the-fold elements only, so nothing flashes) ----------
  var revealEls = Array.prototype.slice.call(document.querySelectorAll('[data-reveal]'));
  if (!reduceMotion && hasObserver) {
    var vh = window.innerHeight || 800;
    var pending = revealEls.filter(function (el) {
      return el.getBoundingClientRect().top > vh;
    });
    pending.forEach(function (el) { el.classList.add('is-pending'); });
    var revealer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        el.classList.remove('is-pending');
        if (el.classList.contains('card')) el.classList.add('is-on');
        revealer.unobserve(el);
      });
    }, { rootMargin: '0px 0px -24px 0px', threshold: 0 });
    pending.forEach(function (el) { revealer.observe(el); });
  }

  // ---------- card glow that follows the cursor ----------
  var cards = document.querySelectorAll('[data-glow]');
  Array.prototype.forEach.call(cards, function (card) {
    card.addEventListener('pointermove', function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
    card.addEventListener('pointerleave', function () {
      card.style.removeProperty('--mx');
      card.style.removeProperty('--my');
    });
  });

  // ---------- cursors blink for four seconds once they are in view, then rest solid ----------
  var cursors = Array.prototype.slice.call(document.querySelectorAll('.cursor'));
  if (!reduceMotion && hasObserver) {
    var cursorWatch = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-live');
        cursorWatch.unobserve(entry.target);
      });
    }, { threshold: 1 });
    cursors.forEach(function (el) { cursorWatch.observe(el); });
  }

  // ---------- the cartridge powers on at load; a mouse over it plays the power-on again ----------
  var art = document.querySelector('.hero__art');
  if (art && !reduceMotion) {
    var POWER_ON = 3000; // the longest power-on animation (delay included), in ms
    var settled = false;
    window.setTimeout(function () { settled = true; }, POWER_ON);
    art.addEventListener('pointerenter', function (e) {
      if (!settled || e.pointerType !== 'mouse') return;
      settled = false;
      art.classList.add('is-reset');
      void art.offsetWidth; // restart the animations
      art.classList.remove('is-reset');
      window.setTimeout(function () { settled = true; }, POWER_ON);
    });
  }
})();
