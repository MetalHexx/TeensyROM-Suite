// A dev tool for designing the page: records it in real time, in a headless browser of its own, and
// writes an MP4 and a GIF, for motion the browser tools' screenshots are too slow to catch. Recordings
// are working material and never go in the repo. Windows, macOS or Linux, with Chrome or Edge and
// ffmpeg; Node built-ins only (the DevTools protocol over Node's WebSocket).
//
//   node src/site/tools/record.mjs --url http://127.0.0.1:8087/TeensyROM-Suite/?clean --seconds 15 --out <folder>/cart
//        [--at <selector>] [--crop] [--from-load] [--hover <selector>] [--width 1440] [--height 1000]
//        [--reduced-motion] [--browser <path>]
//
// --at         a selector scrolled to the middle of the view (before recording; with --from-load, smoothly
//              once recording has begun, so reveals and one-pass sequences play on camera)
// --crop       crop the video to that element (with a margin) instead of the whole view
// --from-load  start recording before the page loads, so load-time motion (the cart's power-on) is captured
// --hover      once recording runs, sweep the pointer across the elements this selector matches (the first
//              six), so cursor-following effects such as the card glow are captured
// --out        the path without extension: <out>.mp4 and <out>.gif are written
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const url = opt('url', 'http://127.0.0.1:8087/TeensyROM-Suite/?clean');
const at = opt('at', null);
const hover = opt('hover', null);
const fromLoad = flag('from-load');
const seconds = Number(opt('seconds', '15'));
const width = Number(opt('width', '1440'));
const height = Number(opt('height', '1000'));
const out = path.resolve(opt('out', 'recording'));
const port = 9300 + Math.floor(Math.random() * 500);

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const browser = opt('browser', null) ?? BROWSERS.find((p) => existsSync(p));
if (!browser) throw new Error('no Chrome or Edge found: pass --browser <path>');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(path.join(os.tmpdir(), 'trom-site-record-'));
const frames = path.join(profile, 'frames');
mkdirSync(frames);
const proc = spawn(browser, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--hide-scrollbars', '--mute-audio', `--window-size=${width},${height}`, 'about:blank',
], { stdio: 'ignore' });

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch { /* not up yet */ }
  }
  if (!target) throw new Error('the browser did not start');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async (expression) =>
    (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;

  const shots = [];
  listeners.push((m) => {
    if (m.method !== 'Page.screencastFrame') return;
    const file = path.join(frames, `f${String(shots.length).padStart(5, '0')}.jpg`);
    writeFileSync(file, Buffer.from(m.params.data, 'base64'));
    shots.push({ file, t: m.params.metadata.timestamp });
    send('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {});
  });
  const startScreencast = () =>
    send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: width, maxHeight: height });

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  if (flag('reduced-motion')) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  }

  const loaded = new Promise((resolve) => listeners.push((m) => m.method === 'Page.loadEventFired' && resolve()));
  let startedAt;
  if (fromLoad) {
    startedAt = Date.now();
    await startScreencast();
  }
  await send('Page.navigate', { url });
  await loaded;

  let clip = null;
  if (at && fromLoad) {
    // Smooth, after recording began: [data-reveal] entrances and one-pass sequences play on camera.
    await sleep(500);
    clip = await evaluate(`(async () => {
      const el = document.querySelector(${JSON.stringify(at)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      let last = -1;
      for (let i = 0; i < 40 && window.scrollY !== last; i++) {
        last = window.scrollY;
        await new Promise((r) => setTimeout(r, 150));
      }
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    })()`);
    if (!clip) throw new Error(`nothing matches ${at}`);
  } else if (at) {
    await sleep(500);
    clip = await evaluate(`(async () => {
      document.documentElement.style.scrollBehavior = 'auto';
      const el = document.querySelector(${JSON.stringify(at)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      await new Promise((r) => setTimeout(r, 300));
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    })()`);
    if (!clip) throw new Error(`nothing matches ${at}`);
  } else if (!fromLoad) {
    await sleep(500);
  }

  if (!fromLoad) {
    startedAt = Date.now();
    await startScreencast();
  }

  if (hover) {
    const count = await evaluate(`Math.min(document.querySelectorAll(${JSON.stringify(hover)}).length, 6)`);
    if (!count) throw new Error(`nothing matches ${hover}`);
    for (let i = 0; i < count; i++) {
      const box = await evaluate(`(() => {
        const el = document.querySelectorAll(${JSON.stringify(hover)})[${i}];
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      })()`);
      await sleep(150);
      // A pass along the element's upper third, one back along its lower third.
      const steps = 24;
      for (const [row, from, to] of [[0.3, 0.05, 0.95], [0.7, 0.95, 0.05]]) {
        for (let s = 0; s <= steps; s++) {
          const x = box.x + box.w * (from + ((to - from) * s) / steps);
          const y = box.y + box.h * row;
          await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
          await sleep(25);
        }
      }
    }
  }

  await sleep(Math.max(0, seconds * 1000 - (Date.now() - startedAt)));
  const end = Date.now() / 1000; // frame timestamps are wall-clock seconds too
  await send('Page.stopScreencast');
  ws.close();
  if (shots.length < 1) throw new Error('no frames were recorded');

  // Each frame lasts until the next one (the last until the end): an ffmpeg concat list with real durations. A
  // page that holds still sends no frames, so a still page is a short list of long frames.
  const list = shots.map((s, i) => {
    const next = shots[i + 1]?.t ?? Math.max(end, s.t + 0.1);
    return `file '${s.file.replaceAll('\\', '/')}'\nduration ${Math.max(0.001, next - s.t).toFixed(4)}`;
  });
  list.push(`file '${shots.at(-1).file.replaceAll('\\', '/')}'`);
  const listFile = path.join(profile, 'frames.txt');
  writeFileSync(listFile, list.join('\n'));

  // The element plus a margin, kept inside the view (on a phone the element can be as wide as the view).
  let crop = '';
  if (clip && flag('crop')) {
    const m = 24;
    const x = Math.max(0, Math.round(clip.x - m));
    const y = Math.max(0, Math.round(clip.y - m));
    const w = Math.min(width - x, Math.round(clip.w + 2 * m)) & ~1;
    const h = Math.min(height - y, Math.round(clip.h + 2 * m)) & ~1;
    crop = `crop=${w}:${h}:${x}:${y},`;
  }
  mkdirSync(path.dirname(out), { recursive: true });
  const ff = (args) => {
    const run = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`ffmpeg: ${run.stderr}`);
  };
  ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-vf', `${crop}fps=30,format=yuv420p`, '-c:v', 'libx264',
    '-crf', '18', `${out}.mp4`]);
  ff(['-i', `${out}.mp4`, '-vf', 'fps=20,scale=720:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
    '-loop', '0', `${out}.gif`]);
  console.log(`${shots.length} frames in ${seconds} s -> ${out}.mp4, ${out}.gif`);
} finally {
  proc.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
}
