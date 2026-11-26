// The DJ Mixer's rig (section 03). The DJ Mixer in your browser sends a tune to the TeensyROM as ASID over USB, the
// TeensyROM writes it to the SID chip, and the chip's three voices dance in wave windows above it, drawn the way the
// mixer draws them (src/libs/ui/components/src/lib/voice-wave: the same wave model, envelope and look). Each note's
// register write rides the wires as a small chip that lands as the note plays and lights the chip's address and data
// pins. The tune is an original two-bar loop, written here as SID register frames, 50 a second.
//
// Progressive: without this file each window shows a still trace. It draws only while the rig is in view, not paused
// and the tab is shown, and a pause holds the picture where it is. Under reduced motion it draws one held pose (dimmed,
// as the mixer holds a voice) and sends no chips. Styles change only through classes and --p; the canvas is drawn here.
(function () {
  'use strict';

  var rig = document.querySelector('.rig');
  var scope = rig ? rig.querySelector('.rig__scope') : null;
  var canvas = scope ? scope.querySelector('.rig__waves') : null;
  var ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  var wins = scope ? Array.prototype.slice.call(scope.querySelectorAll('.rig__win')) : [];
  if (!ctx || wins.length !== 3) return;

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- the mixer's wave model (voice-wave/model) ----------
  var TRI = 16;
  var SAW = 32;
  var PUL = 64;
  var NOI = 128; // the waveform bits of a voice's control register; bit 0 is the gate
  var FRAME_MS = 20; // a PAL frame: ASID sends the chip's registers once a frame

  // Waves shown for a frequency register value: 1.5 to 7 over eight octaves up from 256.
  var cyclesFor = function (freq) {
    if (!(freq > 0)) return 0;
    var t = (Math.log2(freq) - 8) / 8;
    return 1.5 + 5.5 * (t < 0 ? 0 : t > 1 ? 1 : t);
  };
  var dutyFor = function (pw) {
    var d = pw / 4095;
    return d < 0.05 ? 0.05 : d > 0.95 ? 0.95 : d;
  };
  var noiseValue = function (bucket, step) {
    var h = Math.imul(bucket | 0, 374761393) + Math.imul(step | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 2147483647.5 - 1;
  };
  // One point of a voice's wave, -1 to 1, at u (0 to 1) across the window; waveforms set together average.
  var waveSample = function (wave, cycles, duty, u, noiseStep) {
    var phase = u * cycles;
    var cp = phase - Math.floor(phase);
    var sum = 0;
    var n = 0;
    if (wave & TRI) { sum += cp < 0.5 ? 4 * cp - 1 : 3 - 4 * cp; n++; }
    if (wave & SAW) { sum += 2 * cp - 1; n++; }
    if (wave & PUL) { sum += cp < duty ? 1 : -1; n++; }
    if (wave & NOI) { sum += noiseValue(Math.floor(phase * 6), noiseStep); n++; }
    return n ? sum / n : 0;
  };

  // The envelope follower: a hit restarts the attack from the current height, the decay falls to the sustain level, the
  // gate closing starts the release; decay and release fall exponentially over the chip's published times.
  var ATTACK_MS = [2, 8, 16, 24, 38, 56, 68, 80, 100, 250, 500, 800, 1000, 3000, 5000, 8000];
  var FALL_MS = [6, 24, 48, 72, 114, 168, 204, 240, 300, 750, 1500, 2400, 3000, 9000, 15000, 24000];
  var IDLE = 0;
  var ATTACK = 1;
  var DECAY = 2;
  var SUSTAIN = 3;
  var RELEASE = 4;
  var Envelope = function () {
    this.h = 0;
    this.phase = IDLE;
    this.a = 2;
    this.d = 6;
    this.s = 0;
    this.r = 6;
  };
  Envelope.prototype.advance = function (dt) {
    while (dt > 0 && this.phase !== IDLE && this.phase !== SUSTAIN) {
      if (this.phase === ATTACK) {
        var toFull = (1 - this.h) * this.a;
        if (dt < toFull) { this.h += dt / this.a; return; }
        dt -= toFull;
        this.h = 1;
        this.phase = DECAY;
      } else if (this.phase === DECAY) {
        this.h = this.s + (this.h - this.s) * Math.exp((-dt * 4.6) / this.d);
        if (this.h - this.s <= 0.004) { this.h = this.s; this.phase = SUSTAIN; }
        return;
      } else {
        this.h *= Math.exp((-dt * 4.6) / this.r);
        if (this.h <= 0.004) { this.h = 0; this.phase = IDLE; }
        return;
      }
    }
  };
  Envelope.prototype.apply = function (gate, hit, adsr) {
    this.a = ATTACK_MS[adsr[0]];
    this.d = FALL_MS[adsr[1]];
    this.s = adsr[2] / 15;
    this.r = FALL_MS[adsr[3]];
    if (hit) {
      this.phase = ATTACK;
      if (!gate) { this.h = Math.min(1, this.h + FRAME_MS / this.a); this.phase = RELEASE; }
      return;
    }
    if (gate) {
      if (this.phase === IDLE || this.phase === SUSTAIN) { this.h = this.s; this.phase = SUSTAIN; }
    } else if (this.phase !== IDLE && this.phase !== RELEASE) {
      this.phase = RELEASE;
    }
  };

  // ---------- the tune: an original two-bar loop at 125 beats a minute ----------
  // Voice 1 a pulse bass whose pulse width sweeps, so its wave breathes; voice 2 a sawtooth lead that arpeggiates a
  // chord every frame, so its wave shimmers; voice 3 the drums (a noise click into a falling triangle for the kick, a
  // pulse snap into noise for the snare, short noise hats).
  var STEP = 6; // frames a sixteenth
  var FRAMES = STEP * 32; // two bars
  var LOOP_MS = FRAMES * FRAME_MS;
  var freqOf = function (midi) { return Math.round(440 * Math.pow(2, (midi - 69) / 12) * 17.03); }; // PAL clock
  var notes = [[], [], []];
  var note = function (voice, step, gateFrames, adsr, shape) {
    notes[voice].push({ start: step * STEP, gate: gateFrames, adsr: adsr, shape: shape });
  };
  var bassLine = [[0, 33], [3, 33], [6, 45], [8, 31], [11, 31], [14, 43], [16, 29], [19, 29], [22, 41], [24, 31], [27, 31], [30, 43]];
  bassLine.forEach(function (n) {
    note(0, n[0], 4, [0, 6, 8, 4], function (i, frame) {
      return [PUL, freqOf(n[1]), 2048 + Math.round(1500 * Math.sin((frame / FRAMES) * Math.PI * 2))];
    });
  });
  var chords = [[69, 72, 76, 81], [67, 71, 74, 79], [65, 69, 72, 77], [67, 71, 74, 79]];
  chords.forEach(function (chord, k) {
    note(1, k * 8, 44, [1, 8, 9, 8], function (i) { return [SAW, freqOf(chord[i % chord.length]), 0]; });
  });
  var kick = function (i) { return i === 0 ? [NOI, 30000, 0] : [TRI, Math.max(340, Math.round(3746 * Math.pow(0.62, i - 1))), 0]; };
  var snare = function (i) { return i === 0 ? [PUL, freqOf(50), 2048] : [NOI, 20000, 0]; };
  var hat = function () { return [NOI, 52000, 0]; };
  [0, 8, 16, 24, 27].forEach(function (s) { note(2, s, 6, [0, 7, 0, 7], kick); });
  [4, 12, 20, 28].forEach(function (s) { note(2, s, 6, [0, 8, 0, 8], snare); });
  [2, 6, 10, 14, 18, 22, 26].forEach(function (s) { note(2, s, 2, [0, 3, 0, 3], hat); });
  note(2, 30, 3, [0, 6, 0, 6], hat);

  // Each voice's registers, frame by frame: the note that started last (wrapping round the loop) sets them, its gate
  // open for its first frames and closed after, so the release still shows its wave.
  var regs = notes.map(function (list) {
    list.sort(function (a, b) { return a.start - b.start; });
    var out = [];
    for (var f = 0; f < FRAMES; f++) {
      var cur = list[list.length - 1];
      for (var k = 0; k < list.length; k++) if (list[k].start <= f) cur = list[k];
      var i = (f - cur.start + FRAMES) % FRAMES;
      var sh = cur.shape(i, f);
      out.push({ wave: sh[0], freq: sh[1], duty: dutyFor(sh[2]), gate: i < cur.gate ? 1 : 0, hit: i === 0, adsr: cur.adsr });
    }
    return out;
  });

  // The windows' table: each frame's wave, cycles, duty and envelope height (two passes, so the loop joins up).
  var table = regs.map(function (frames) {
    var env = new Envelope();
    var rows = [];
    for (var pass = 0; pass < 2; pass++) {
      for (var f = 0; f < FRAMES; f++) {
        var r = frames[f];
        env.advance(FRAME_MS);
        env.apply(r.gate, r.hit, r.adsr);
        if (pass) rows.push({ wave: r.wave, cycles: cyclesFor(r.freq), duty: r.duty, amp: env.phase === IDLE ? 0 : env.h });
      }
    }
    return rows;
  });

  // The register writes worth a chip: each note's gate opening, one chip a step (the lead first, then the drums).
  var CTRL = ['D404', 'D40B', 'D412'];
  var events = [];
  var byStep = {};
  [1, 2, 0].forEach(function (v) {
    notes[v].forEach(function (n) {
      if (byStep[n.start]) return;
      var r = regs[v][n.start];
      byStep[n.start] = true;
      events.push({ t: n.start * FRAME_MS, v: v + 1, label: CTRL[v], addr: 4 + 7 * v, val: r.wave | 1 });
    });
  });
  events.sort(function (a, b) { return a.t - b.t; });

  // ---------- the chips on the wires ----------
  var LEAD = 600; // a chip leaves the browser this long before its note plays
  var T1 = 260; // along the ASID wire
  var DWELL = 40; // through the TeensyROM
  var T2 = LEAD - T1 - DWELL; // along the register wire, landing as the note plays
  var pools = [1, 2].map(function (w) {
    return Array.prototype.slice.call(rig.querySelectorAll('.rig__link--' + w + ' .rig__pkt')).map(function (el) {
      return { el: el, b: el.querySelector('b'), ev: null };
    });
  });
  var cart = rig.querySelector('.rig__art--cart');
  var pins = {};
  Array.prototype.forEach.call(rig.querySelectorAll('.rig__pins [data-pin]'), function (p) { pins[p.getAttribute('data-pin')] = p; });
  var lit = [];

  // Along a long wire the chips speed up, like the packets in How it works; on the short wires of the stacked layout
  // they keep a steady pace, so chips a sixteenth apart never bunch up.
  var steady = false;
  var wireEl = rig.querySelector('.rig__wire');
  var setChip = function (slot, ev, p) {
    if (slot.ev !== ev) {
      slot.ev = ev;
      slot.el.className = 'rig__pkt is-live is-v' + ev.v;
      if (slot.b) slot.b.textContent = ev.label;
    }
    slot.el.style.setProperty('--p', (steady ? p : p * p).toFixed(4));
  };
  var placeChips = function (s) {
    var used = [0, 0];
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var d = ev.t - s;
      if (d < 0) d += LOOP_MS;
      if (d > LEAD) continue;
      var since = LEAD - d;
      var wire;
      var p;
      if (since < T1) { wire = 0; p = since / T1; } else if (since < T1 + DWELL) { continue; } else { wire = 1; p = (since - T1 - DWELL) / T2; }
      var pool = pools[wire];
      if (used[wire] < pool.length) setChip(pool[used[wire]++], ev, p);
    }
    for (var w = 0; w < 2; w++) {
      for (var k = used[w]; k < pools[w].length; k++) {
        if (pools[w][k].ev) { pools[w][k].ev = null; pools[w][k].el.classList.remove('is-live'); }
      }
    }
  };
  // Light a pin (or the cart) for one frame; its CSS transition fades it.
  var light = function (el) { if (el) { el.classList.add('is-hit'); lit.push(el); } };
  var unlight = function () {
    lit.forEach(function (el) { el.classList.remove('is-hit'); });
    lit = [];
  };
  // Did time t pass between song times a and b (b after a, round the loop)?
  var passed = function (t, a, b) {
    t = (t + LOOP_MS) % LOOP_MS;
    return a <= b ? t > a && t <= b : t > a || t <= b;
  };
  var land = function (a, b) {
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (passed(ev.t - LEAD + T1, a, b)) light(cart);
      if (!passed(ev.t, a, b)) continue;
      light(pins[8]); // chip select
      for (var bit = 0; bit < 5; bit++) if ((ev.addr >> bit) & 1) light(pins[9 + bit]); // A0 to A4
      for (bit = 0; bit < 8; bit++) if ((ev.val >> bit) & 1) light(pins[15 + bit]); // D0 to D7
    }
  };

  // ---------- the windows, drawn the way the mixer draws them (voice-wave/paint) ----------
  var parse = function (css, fallback) {
    var m = /^#([0-9a-f]{6})$/i.exec((css || '').trim());
    if (!m) return fallback;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  var rootStyle = getComputedStyle(document.documentElement);
  var colours = [
    parse(rootStyle.getPropertyValue('--magenta'), [179, 51, 179]),
    parse(rootStyle.getPropertyValue('--cyan'), [0, 247, 255]),
    parse(rootStyle.getPropertyValue('--yellow'), [245, 226, 158])
  ];
  var GLASS = [8, 6, 10];
  var mix = function (a, b, t) { return Math.round(a + (b - a) * t); };
  var rgba = function (c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; };
  var mixRgb = function (c, d, t) { return [mix(c[0], d[0], t), mix(c[1], d[1], t), mix(c[2], d[2], t)]; };

  var layer = document.createElement('canvas');
  var dpr = 1;
  var views = []; // per window: its inner box in device pixels, gradients and point buffer

  var edgeFade = function (x, w, c) {
    var g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, rgba(c, 0));
    g.addColorStop(0.07, rgba(c, 1));
    g.addColorStop(0.93, rgba(c, 1));
    g.addColorStop(1, rgba(c, 0));
    return g;
  };
  var layout = function () {
    var box = scope.getBoundingClientRect();
    if (box.width < 1) return false;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    steady = !!wireEl && wireEl.clientHeight > wireEl.clientWidth;
    canvas.width = layer.width = Math.round(box.width * dpr);
    canvas.height = layer.height = Math.round(box.height * dpr);
    var c = layer.getContext('2d');
    var line = Math.max(1, Math.round(dpr));
    views = wins.map(function (win, v) {
      var b = win.getBoundingClientRect();
      var x0 = Math.round((b.left - box.left) * dpr);
      var y0 = Math.round((b.top - box.top) * dpr);
      var x1 = Math.round((b.right - box.left) * dpr);
      var y1 = Math.round((b.bottom - box.top) * dpr);
      c.fillStyle = '#2b242e'; // the window's border
      c.fillRect(x0, y0, x1 - x0, y1 - y0);
      var x = x0 + line;
      var y = y0 + line;
      var w = x1 - x0 - 2 * line;
      var h = y1 - y0 - 2 * line;
      var trace = colours[v];
      // glass, tinted toward the voice
      c.save();
      c.beginPath();
      c.rect(x, y, w, h);
      c.clip();
      c.translate(x + w / 2, y + h / 2);
      c.scale(w / 2, h / 2);
      var glass = c.createRadialGradient(0, 0, 0, 0, 0, 1.1);
      glass.addColorStop(0, rgba(mixRgb(GLASS, trace, 0.11), 1));
      glass.addColorStop(1, rgba(GLASS, 1));
      c.fillStyle = glass;
      c.fillRect(-1, -1, 2, 2);
      c.restore();
      // graticule, dashed centre line, sheen, scanlines
      c.fillStyle = 'rgba(255,255,255,0.055)';
      for (var i = 0; i < 4; i++) c.fillRect(x, y + Math.round((h * i) / 4), w, line);
      c.fillStyle = 'rgba(255,255,255,0.045)';
      for (i = 0; i < 8; i++) c.fillRect(x + Math.round((w * i) / 8), y, line, h);
      c.fillStyle = 'rgba(255,255,255,0.14)';
      var cy = y + Math.round((h - line) / 2);
      for (var dx = 0; dx < w; dx += 7 * dpr) c.fillRect(x + Math.round(dx), cy, Math.min(Math.round(2 * dpr), w - Math.round(dx)), line);
      var sheen = c.createLinearGradient(0, y, 0, y + h);
      sheen.addColorStop(0, 'rgba(255,255,255,0.07)');
      sheen.addColorStop(0.42, 'rgba(255,255,255,0)');
      c.fillStyle = sheen;
      c.fillRect(x, y, w, h);
      c.fillStyle = 'rgba(0,0,0,0.26)';
      for (var dy = 0; dy < h; dy += 3 * dpr) c.fillRect(x, y + Math.round(dy), w, line);
      return {
        x: x, y: y, w: w, h: h,
        glow: edgeFade(x, w, trace),
        core: edgeFade(x, w, mixRgb(trace, [255, 255, 255], 0.5)),
        flat: rgba(mixRgb(trace, [85, 85, 85], 0.45), 1),
        points: new Float32Array(2 * Math.max(2, Math.ceil(w / 2)))
      };
    });
    return true;
  };

  var draw = function (s, alpha) {
    var f = Math.floor(s / FRAME_MS) % FRAMES;
    var frac = s / FRAME_MS - Math.floor(s / FRAME_MS);
    var noiseStep = Math.floor((s * 20) / 1000);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(layer, 0, 0);
    for (var v = 0; v < 3; v++) {
      var box = views[v];
      var row = table[v][f];
      var amp = row.amp + (table[v][(f + 1) % FRAMES].amp - row.amp) * frac;
      ctx.save();
      ctx.beginPath();
      ctx.rect(box.x, box.y, box.w, box.h);
      ctx.clip();
      if (amp <= 0 || !row.wave) {
        var t = Math.max(1, Math.round(1.2 * dpr));
        ctx.fillStyle = box.flat;
        ctx.fillRect(box.x, box.y + Math.round((box.h - t) / 2), box.w, t);
        ctx.restore();
        continue;
      }
      var pts = box.points;
      var n = pts.length >> 1;
      var centre = box.y + box.h / 2;
      var reach = (box.h / 2) * 0.82 * amp;
      for (var i = 0; i < n; i++) {
        var u = i / (n - 1);
        pts[2 * i] = box.x + u * box.w;
        pts[2 * i + 1] = centre - reach * waveSample(row.wave, row.cycles, row.duty, u, noiseStep);
      }
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (i = 1; i < n; i++) ctx.lineTo(pts[2 * i], pts[2 * i + 1]);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = box.glow;
      ctx.lineWidth = 6 * dpr;
      ctx.globalAlpha = 0.12 * alpha;
      ctx.stroke();
      ctx.lineWidth = 3.5 * dpr;
      ctx.globalAlpha = 0.28 * alpha;
      ctx.stroke();
      ctx.strokeStyle = box.core;
      ctx.lineWidth = 1.7 * dpr;
      ctx.globalAlpha = alpha;
      ctx.stroke();
      ctx.restore();
    }
  };

  // ---------- run only while it can be seen ----------
  var HELD_AT = 2 * FRAME_MS; // the pose under reduced motion: the downbeat, every voice sounding
  var song = reduceMotion ? HELD_AT : 0;
  var raf = 0;
  var last = 0;
  var paused = false;
  var inView = !('IntersectionObserver' in window);
  var ready = false;
  var running = function () { return ready && !reduceMotion && !paused && inView && !document.hidden; };
  var tick = function (now) {
    raf = 0;
    if (!running()) return;
    var dt = last ? Math.min(now - last, 100) : 0; // a long gap (a stalled tab) never jumps the tune
    last = now;
    var before = song;
    song = (song + dt) % LOOP_MS;
    unlight();
    if (dt > 0) land(before, song);
    draw(song, 1);
    placeChips(song);
    raf = requestAnimationFrame(tick);
  };
  var schedule = function () {
    if (running()) {
      if (!raf) { last = 0; raf = requestAnimationFrame(tick); }
      return;
    }
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    unlight();
  };
  var redraw = function () {
    if (!layout()) return;
    ready = true;
    draw(song, reduceMotion ? 0.6 : 1);
    rig.classList.add('is-live');
    schedule();
  };

  var pauseBtn = rig.querySelector('.rig__pause');
  if (pauseBtn && !reduceMotion) {
    var pauseLabel = pauseBtn.querySelector('.rig__pause-label');
    pauseBtn.hidden = false;
    pauseBtn.addEventListener('click', function () {
      paused = !paused;
      rig.classList.toggle('is-paused', paused);
      if (pauseLabel) pauseLabel.textContent = paused ? 'Play animation' : 'Pause animation';
      schedule();
    });
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      inView = entries[entries.length - 1].isIntersecting;
      schedule();
    }).observe(rig);
  }
  document.addEventListener('visibilitychange', schedule);
  // A zoom, or a move to a screen of another density, changes the pixel ratio without resizing the windows, so
  // redraw then too: listen on the ratio's own media query, and re-arm it on each change.
  var watchDpr = function () {
    if (!window.matchMedia) return;
    var mq = window.matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
    var onChange = function () {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
      redraw();
      watchDpr();
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
  };
  watchDpr();
  if ('ResizeObserver' in window) {
    new ResizeObserver(redraw).observe(scope);
  } else {
    window.addEventListener('resize', redraw);
    redraw();
  }
})();
