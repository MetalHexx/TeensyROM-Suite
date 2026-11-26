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

  // ---------- how it works: the diagram's pause button (WCAG 2.2.2) ----------
  // Paused, the diagram rests complete (every node lit, the traces drawn) and nothing moves. Under reduced motion it
  // already rests that way, so the button stays hidden.
  var flow = document.querySelector('.flow');
  var flowPause = document.querySelector('.flow__pause');
  if (flow && flowPause && !reduceMotion) {
    var flowLabel = flowPause.querySelector('.flow__pause-label');
    flowPause.hidden = false;
    flowPause.addEventListener('click', function () {
      var paused = flow.classList.toggle('is-paused');
      flowPause.setAttribute('aria-pressed', paused ? 'true' : 'false');
      if (flowLabel) flowLabel.textContent = paused ? 'Play animation' : 'Pause animation';
    });
  }

  // ---------- Trom Agent: the conversation plays once when it scrolls in ----------
  // Each message rises in turn (about four seconds, no loop). Under reduced motion every message is simply shown.
  var chat = document.querySelector('.chat');
  if (chat && !reduceMotion && hasObserver) {
    chat.classList.add('is-pending');
    var chatWatch = new IntersectionObserver(function (entries) {
      if (!entries.some(function (entry) { return entry.isIntersecting; })) return;
      chat.classList.remove('is-pending');
      chat.classList.add('is-playing');
      chatWatch.disconnect();
    }, { threshold: 0.4 });
    chatWatch.observe(chat);
  }

  // ---------- the TV: ten channels that change by themselves ----------
  // A WAI-ARIA carousel with a pause button (WCAG 2.2.2). The channels change on their own except on hover and keyboard
  // focus, off screen, in a hidden tab, under reduced motion, while paused and while a video plays. A picture loads
  // only when its channel is next. Each video channel is a facade: nothing is requested from YouTube until play.
  var tv = document.querySelector('.tv');
  if (tv) {
    var ID_RE = /^[A-Za-z0-9_-]{11}$/;
    var PLAY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges"><path fill="currentColor" d="M4 2h2v12H4zM6 3h2v10H6zM8 4h2v8H8zM10 5h2v6h-2zM12 6h2v4h-2z"/></svg>';
    var chans = Array.prototype.slice.call(tv.querySelectorAll('.tv__ch'));
    var live = tv.querySelector('.tv__channels');
    var num = tv.querySelector('.tv__num');
    var controls = tv.querySelector('.tv__controls');
    var pauseBtn = tv.querySelector('[data-tv="pause"]');
    var HOLD = 4500; // a screenshot, in ms, unless the channel has data-hold
    var OFF = 460; // the CRT switch-off, matching site.css
    var DARK = 120;
    var ON = 420;
    var cur = 0;
    var timer = 0;
    var osdTimer = 0;
    var busy = false;
    var paused = false;
    var held = false;
    var seen = false;
    var visible = !hasObserver;
    var playing = -1; // the channel whose video is playing, or -1

    // The channels change by themselves only while this holds; hover and keyboard focus (held) hold them besides.
    var running = function () {
      return !reduceMotion && !paused && playing < 0 && visible && !document.hidden;
    };
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    var holdFor = function (i) { return parseInt(chans[i].getAttribute('data-hold'), 10) || HOLD; };
    // Fetch the channel's picture now: an eager <img> loads even while its channel is hidden.
    var warm = function (i) {
      var img = chans[i].querySelector('img[loading="lazy"]');
      if (img) img.loading = 'eager';
    };
    var osd = function () {
      tv.classList.add('osd-on');
      clearTimeout(osdTimer);
      osdTimer = setTimeout(function () { tv.classList.remove('osd-on'); }, 2000);
    };

    // One facade per video channel: the poster inside a play button, replaced by the player on a click.
    var videos = chans.map(function (ch, i) {
      var id = ch.getAttribute('data-video-id') || '';
      var stage = ch.querySelector('.video__stage');
      var img = ch.querySelector('.video__img');
      if (!ID_RE.test(id) || !stage || !img) return null;
      var title = ch.getAttribute('data-video-title') || 'video';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'video__btn';
      btn.setAttribute('aria-label', 'Play video: ' + title);
      var icon = document.createElement('span');
      icon.className = 'video__play';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = PLAY_ICON;
      btn.appendChild(img);
      btn.appendChild(icon);
      stage.replaceChildren(btn);
      btn.addEventListener('click', function () { startVideo(i); });
      return { id: id, title: title, stage: stage, btn: btn };
    });
    var startVideo = function (i) {
      var v = videos[i];
      if (!v || busy || playing >= 0) return;
      var frame = document.createElement('iframe');
      frame.src = 'https://www.youtube-nocookie.com/embed/' + v.id + '?autoplay=1&rel=0&cc_load_policy=1';
      frame.title = v.title;
      frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      v.stage.replaceChildren(frame);
      frame.focus();
      playing = i;
      tv.classList.add('is-playing');
      schedule();
    };
    // Back to the poster facade, which drops the player and so stops the video.
    var stopVideo = function () {
      if (playing < 0) return;
      videos[playing].stage.replaceChildren(videos[playing].btn);
      playing = -1;
      tv.classList.remove('is-playing');
    };

    var show = function (i) {
      chans[cur].hidden = true;
      chans[i].hidden = false;
      cur = i;
      num.textContent = pad(i + 1);
      osd();
      warm((i + 1) % chans.length);
    };
    var change = function (step, byHand) {
      if (busy) return;
      var next = (cur + step + chans.length) % chans.length;
      live.setAttribute('aria-live', byHand || paused ? 'polite' : 'off');
      warm(next);
      stopVideo();
      if (reduceMotion) { show(next); return; }
      busy = true;
      tv.classList.add('is-off');
      setTimeout(function () {
        show(next);
        tv.classList.remove('is-off');
        tv.classList.add('is-dark');
        setTimeout(function () {
          tv.classList.remove('is-dark');
          tv.classList.add('is-on');
          setTimeout(function () { tv.classList.remove('is-on'); busy = false; schedule(); }, ON);
        }, DARK);
      }, OFF);
    };
    var tick = function () {
      timer = 0;
      if (running() && !held) change(1, false);
    };
    // (Re)start the clock for the current channel, or stop it. The glass's drifting highlight follows it.
    var schedule = function () {
      clearTimeout(timer);
      timer = 0;
      tv.classList.toggle('is-still', !running());
      if (busy || !running() || held) return;
      timer = setTimeout(tick, holdFor(cur));
    };

    controls.hidden = false;
    if (reduceMotion) pauseBtn.hidden = true;
    tv.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-tv]') : null;
      if (!btn) return;
      var what = btn.getAttribute('data-tv');
      if (what === 'pause') {
        paused = !paused;
        pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false');
        pauseBtn.setAttribute('aria-label', paused ? 'Resume automatic channel changes' : 'Pause automatic channel changes');
        live.setAttribute('aria-live', paused ? 'polite' : 'off');
        schedule();
      } else {
        change(what === 'next' ? 1 : -1, true);
      }
    });
    // A mouse over the TV, or keyboard focus on its buttons, holds the channel. A tap or a click does not.
    var hover = false;
    var focused = false;
    var hold = function () { held = hover || focused; schedule(); };
    tv.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') { hover = true; hold(); } });
    tv.addEventListener('pointerleave', function () { hover = false; hold(); });
    tv.addEventListener('focusin', function (e) {
      try { focused = e.target.matches(':focus-visible'); } catch (err) { focused = true; }
      hold();
    });
    tv.addEventListener('focusout', function (e) {
      if (!tv.contains(e.relatedTarget)) { focused = false; hold(); }
    });
    document.addEventListener('visibilitychange', schedule);

    if (!visible) {
      // Dark until the TV is on screen, then it switches on.
      if (!reduceMotion) tv.classList.add('is-dark');
      schedule();
      new IntersectionObserver(function (entries) {
        visible = entries[entries.length - 1].intersectionRatio >= 0.3;
        if (visible && !seen) {
          seen = true;
          warm(0);
          warm(1);
          if (reduceMotion) { osd(); schedule(); return; }
          busy = true;
          setTimeout(function () {
            tv.classList.remove('is-dark');
            tv.classList.add('is-on');
            osd();
            setTimeout(function () { tv.classList.remove('is-on'); busy = false; schedule(); }, ON);
          }, 250);
          return;
        }
        schedule();
      }, { threshold: [0, 0.3] }).observe(tv);
    } else {
      warm(1);
      osd();
      schedule();
    }
  }
})();
