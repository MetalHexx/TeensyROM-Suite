// TeensyROM Suite product page. Progressive only: the page reads fully without this file.
(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.add('js');

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasObserver = 'IntersectionObserver' in window;

  // Everything that stops in a hidden tab listens here, once.
  var onVisibility = [];
  document.addEventListener('visibilitychange', function () {
    onVisibility.forEach(function (fn) { fn(); });
  });

  // Fetch a picture now: an eager <img> loads even while it is hidden.
  var warmImg = function (img) {
    if (img && img.getAttribute('loading') === 'lazy') img.loading = 'eager';
  };

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

  // ---------- the CRT switch, shared by the TVs and the C64's screen ----------
  // The host (.crt) switches off (the picture squashes to a hot line, then a dot), stays dark for a beat while swap()
  // changes the picture, then switches on with a slight overshoot; done() runs once it rests. The times mirror the
  // crt-* keyframes in site.css: change them together.
  var CRT_OFF = 460;
  var CRT_DARK = 120;
  var CRT_ON = 420;
  var crtOn = function (host, done) {
    host.classList.remove('is-dark');
    host.classList.add('is-on');
    setTimeout(function () {
      host.classList.remove('is-on');
      if (done) done();
    }, CRT_ON);
  };
  var crtSwitch = function (host, swap, done) {
    host.classList.add('is-off');
    setTimeout(function () {
      swap();
      host.classList.remove('is-off');
      host.classList.add('is-dark');
      setTimeout(function () { crtOn(host, done); }, CRT_DARK);
    }, CRT_OFF);
  };

  // ---------- how it works: one pass of the diagram every 4.2 s, and the C64's screen ----------
  // site.css holds the timeline; this restarts it (.is-run) while the diagram is in view, not paused, the tab is shown
  // and motion is allowed, and otherwise drops it, which leaves the rest state: every node lit, no packet (WCAG 2.2.2).
  // When the last packet lands on the C64 (its ping), the C64's screen launches the next frame with the CRT switch.
  var flow = document.querySelector('.flow');
  if (flow && !reduceMotion) {
    var LOOP = 4200; // one pass, in ms: the last fade in site.css (--fade + 0.45 s) ends before it
    var flowPause = document.querySelector('.flow__pause');
    var flowLabel = flowPause ? flowPause.querySelector('.flow__pause-label') : null;
    var flowPaused = false;
    var flowSeen = !hasObserver;
    var flowTimer = 0;
    var flowRunning = function () { return !flowPaused && flowSeen && !document.hidden; };
    var pass = function () {
      flowTimer = 0;
      flow.classList.remove('is-run');
      if (!flowRunning()) return;
      void flow.offsetWidth; // restart the animations
      flow.classList.add('is-run');
      flowTimer = setTimeout(pass, LOOP);
    };
    var flowSchedule = function () {
      if (flowRunning()) {
        if (!flowTimer) pass();
        return;
      }
      clearTimeout(flowTimer);
      flowTimer = 0;
      flow.classList.remove('is-run');
    };

    if (flowPause) {
      flowPause.hidden = false;
      flowPause.addEventListener('click', function () {
        flowPaused = !flowPaused;
        flow.classList.toggle('is-paused', flowPaused);
        flowPause.setAttribute('aria-pressed', flowPaused ? 'true' : 'false');
        if (flowLabel) flowLabel.textContent = flowPaused ? 'Play animation' : 'Pause animation';
        flowSchedule();
      });
    }

    var tube = flow.querySelector('.flow__tube');
    var frames = tube ? Array.prototype.slice.call(tube.querySelectorAll('.flow__frames img')) : [];
    var frame = 0;
    if (frames.length > 1) {
      flow.addEventListener('animationstart', function (e) {
        if (e.animationName !== 'ping' || !e.target.classList.contains('flow__node--c64')) return;
        if (/\bis-(off|dark|on)\b/.test(tube.className)) return;
        var next = (frame + 1) % frames.length;
        warmImg(frames[next]);
        crtSwitch(tube, function () {
          frames[frame].hidden = true;
          frames[next].hidden = false;
          frame = next;
          warmImg(frames[(next + 1) % frames.length]);
        });
      });
    }

    if (hasObserver) {
      new IntersectionObserver(function (entries) {
        flowSeen = entries[entries.length - 1].isIntersecting;
        if (flowSeen) { warmImg(frames[0]); warmImg(frames[1]); }
        flowSchedule();
      }).observe(flow);
    } else {
      warmImg(frames[1]);
    }
    onVisibility.push(flowSchedule);
    flowSchedule();
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

  // ---------- the TVs: channels that change by themselves ----------
  // Each .tv is a WAI-ARIA carousel with a pause button (WCAG 2.2.2), run on its own. The channels change on their own
  // except on hover and keyboard focus, off screen, in a hidden tab, under reduced motion, while paused and while a video
  // plays. A picture loads only when its channel is next. Each video channel is a facade: nothing is requested from
  // YouTube until play, and starting a video on one TV stops any other TV's video.
  var ID_RE = /^[A-Za-z0-9_-]{11}$/;
  var PLAY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges"><path fill="currentColor" d="M4 2h2v12H4zM6 3h2v10H6zM8 4h2v8H8zM10 5h2v6h-2zM12 6h2v4h-2z"/></svg>';
  var HOLD = 4500; // a screenshot, in ms, unless the channel has data-hold
  var tvs = [];

  // Sets up one TV. Returns its { schedule, stop }, or null when a part is missing (that TV then stays as the HTML has it).
  var initTv = function (tv) {
    var chans = Array.prototype.slice.call(tv.querySelectorAll('.tv__ch'));
    var live = tv.querySelector('.tv__channels');
    var num = tv.querySelector('.tv__num');
    var controls = tv.querySelector('.tv__controls');
    var pauseBtn = tv.querySelector('[data-tv="pause"]');
    if (!chans.length || !live || !num || !controls || !pauseBtn) return null;
    var n = chans.length;
    var cur = 0;
    var timer = 0;
    var osdTimer = 0;
    var busy = false;
    var paused = false;
    var held = false;
    var seen = false;
    var visible = !hasObserver;
    var playing = -1; // the channel whose video is playing, or -1
    var self = {};

    // The channels change by themselves only while this holds; hover and keyboard focus (held) hold them besides.
    var running = function () {
      return n > 1 && !reduceMotion && !paused && playing < 0 && visible && !document.hidden;
    };
    var pad = function (i) { return i < 10 ? '0' + i : String(i); };
    var holdFor = function (i) { return parseInt(chans[i].getAttribute('data-hold'), 10) || HOLD; };
    var warm = function (i) { warmImg(chans[i % n].querySelector('img')); };
    var osd = function () {
      tv.classList.add('osd-on');
      clearTimeout(osdTimer);
      osdTimer = setTimeout(function () { tv.classList.remove('osd-on'); }, 2000);
    };

    // Back to the poster facade, which drops the player and so stops the video.
    var stopVideo = function () {
      if (playing < 0) return;
      videos[playing].stage.replaceChildren(videos[playing].btn);
      playing = -1;
      tv.classList.remove('is-playing');
    };
    var startVideo = function (i) {
      var v = videos[i];
      if (!v || busy || playing >= 0) return;
      tvs.forEach(function (other) { if (other !== self) other.stop(); });
      var frame = document.createElement('iframe');
      frame.src = 'https://www.youtube-nocookie.com/embed/' + v.id + '?autoplay=1&rel=0&cc_load_policy=1';
      frame.title = v.title;
      frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      v.stage.replaceChildren(frame);
      frame.focus();
      playing = i;
      tv.classList.add('is-playing');
      schedule();
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

    var show = function (i) {
      chans[cur].hidden = true;
      chans[i].hidden = false;
      cur = i;
      num.textContent = pad(i + 1);
      osd();
      warm(i + 1);
    };
    var change = function (step, byHand) {
      if (busy || n < 2) return;
      var next = (cur + step + n) % n;
      live.setAttribute('aria-live', byHand || paused ? 'polite' : 'off');
      warm(next);
      stopVideo();
      if (reduceMotion) { show(next); schedule(); return; }
      busy = true;
      crtSwitch(tv, function () { show(next); }, function () { busy = false; schedule(); });
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
    self.schedule = schedule;
    self.stop = function () { stopVideo(); schedule(); };

    if (n > 1) controls.hidden = false;
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
            crtOn(tv, function () { busy = false; schedule(); });
            osd();
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
    return self;
  };

  Array.prototype.forEach.call(document.querySelectorAll('.tv'), function (tv) {
    var ctl = initTv(tv);
    if (!ctl) return;
    tvs.push(ctl);
    onVisibility.push(ctl.schedule);
  });
})();
