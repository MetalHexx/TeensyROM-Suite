import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SiteError } from '../lib/config.mjs';
import { startSiteServer } from '../lib/serve.mjs';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'page');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'trom-site-serve-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
const waitFor = async (promise, what, ms = 5000) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out waiting for ' + what)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

/** Starts a server over a fresh copy of the fixture. */
async function start(options = {}) {
  const dir = path.join(scratch, `case-${counter++}`);
  const src = path.join(dir, 'src');
  fs.cpSync(FIXTURE, src, { recursive: true });
  const errors = [];
  const oks = [];
  const waiters = [];
  const notify = () => waiters.splice(0).forEach((resolve) => resolve());
  const server = await startSiteServer({
    src,
    out: path.join(dir, 'build'),
    port: 0,
    debounceMs: 20,
    log: {
      ok: (m) => { oks.push(m); notify(); },
      error: (m) => { errors.push(m); notify(); },
    },
    ...options,
  });
  const logged = (list, count) => waitFor(new Promise((resolve) => {
    const check = () => (list.length >= count ? resolve() : waiters.push(check));
    check();
  }), 'a log line');
  return { server, src, errors, oks, logged };
}

/** One request with the path exactly as given (no client-side normalisation). */
function request(server, requestPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.port, path: requestPath, method }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

const PAGE = '/TeensyROM-Suite/';

test('the page is served under its sub-path with the dev client injected', async () => {
  const { server } = await start();
  try {
    const res = await request(server, PAGE);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /^text\/html/);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.match(res.body, /<link rel="stylesheet" href="\/TeensyROM-Suite\/__dev\/dev\.css">\s*<script src="\/TeensyROM-Suite\/__dev\/dev\.js" defer><\/script>\s*<\/head>/);
    assert.equal(server.url, `http://127.0.0.1:${server.port}${PAGE}`);
    assert.equal(server.previewUrl, `http://127.0.0.1:${server.port}${PAGE}__dev/preview`);

    const head = await request(server, PAGE, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
    assert.equal((await request(server, PAGE, 'POST')).status, 405);
  } finally {
    await server.close();
  }
});

test('other files are served as they are, with their type', async () => {
  const { server } = await start();
  try {
    const css = await request(server, `${PAGE}css/site.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers['content-type'], /^text\/css/);
    assert.ok(!css.body.includes('__dev'));
    assert.match((await request(server, `${PAGE}img/mark.svg`)).headers['content-type'], /^image\/svg\+xml/);
    assert.equal((await request(server, `${PAGE}nope.html`)).status, 404);
  } finally {
    await server.close();
  }
});

test('/ and the bare sub-path redirect to the page', async () => {
  const { server } = await start();
  try {
    for (const from of ['/', '/TeensyROM-Suite']) {
      const res = await request(server, from);
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, PAGE);
    }
  } finally {
    await server.close();
  }
});

test('paths that leave the build, or the sub-path, are 404', async () => {
  const { server } = await start();
  try {
    for (const bad of [
      `${PAGE}../secret.txt`,
      `${PAGE}..%2f..%2fpackage.json`,
      `${PAGE}%2e%2e/%2e%2e/x`,
      `${PAGE}css/..\\..\\x`,
      `${PAGE}a%00b`,
      '/index.html',
      '/TeensyROM-Suite-other/',
      `${PAGE}__dev/fonts/../../site.mjs`,
      `${PAGE}__dev/unknown`,
    ]) {
      assert.equal((await request(server, bad)).status, 404, bad);
    }
  } finally {
    await server.close();
  }
});

test('__dev/preview shows three frames and passes ?clean and the hash on', async () => {
  const { server } = await start();
  try {
    const res = await request(server, `${PAGE}__dev/preview?clean`);
    assert.equal(res.status, 200);
    assert.equal(res.body.match(/<iframe /g).length, 3);
    for (const width of ['1440', '768', '390']) assert.ok(res.body.includes(`${width}`));
    assert.ok(res.body.includes(`src="${PAGE}"`));
    assert.ok(res.body.includes("'?clean'") && res.body.includes('location.hash'));
    assert.ok(!res.body.includes('__dev/dev.js'));
  } finally {
    await server.close();
  }
});

test('dev.js and dev.css are served; the font trial uses absolute dev URLs', async () => {
  const { server } = await start();
  try {
    const js = await request(server, `${PAGE}__dev/dev.js`);
    assert.match(js.headers['content-type'], /^text\/javascript/);
    assert.ok(js.body.includes('/TeensyROM-Suite/__dev/events'));
    assert.ok(js.body.includes('/TeensyROM-Suite/__dev/fonts/'));
    assert.ok(js.body.includes('trom-site-dev-font'));
    assert.match((await request(server, `${PAGE}__dev/dev.css`)).headers['content-type'], /^text\/css/);
    assert.equal((await request(server, `${PAGE}__dev/fonts/fonts.json`)).status, 404);
  } finally {
    await server.close();
  }
});

/** Opens the event stream; resolves to `{ next(), end() }` where `next()` waits for the next `event:` line. */
function openEvents(server) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: server.port, path: `${PAGE}__dev/events` }, (res) => {
      let buffer = '';
      const waiting = [];
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        for (const resolveNext of waiting.splice(0)) resolveNext();
      });
      const next = () => waitFor(new Promise((done) => {
        const look = () => {
          const match = /event: (\w+)/.exec(buffer);
          if (!match) return waiting.push(look);
          buffer = buffer.slice(match.index + match[0].length);
          done(match[1]);
        };
        look();
      }), 'an event');
      resolve({ next, end: () => req.destroy(), status: res.statusCode });
    });
    req.on('error', reject);
  });
}

test('a file change rebuilds and sends a reload event', async () => {
  const { server, src, logged, oks } = await start();
  try {
    const events = await openEvents(server);
    assert.equal(events.status, 200);
    fs.appendFileSync(path.join(src, 'css', 'site.css'), '\n.changed { color: red; }\n');
    assert.equal(await events.next(), 'reload');
    await logged(oks, 1);
    assert.match((await request(server, `${PAGE}css/site.css`)).body, /\.changed/);
    events.end();
  } finally {
    await server.close();
  }
});

test('a broken rebuild keeps serving the last good build', async () => {
  const { server, src, errors, logged } = await start();
  try {
    const index = path.join(src, 'index.html');
    fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace('<!-- release:hero:end -->', ''));
    await logged(errors, 1);
    assert.match(errors[0], /rebuild failed, still serving the last good build/);
    const res = await request(server, PAGE);
    assert.equal(res.status, 200);
    assert.match(res.body, /See the releases/);
  } finally {
    await server.close();
  }
});

test('a taken port is a clear error with a --port hint', async () => {
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = blocker.address();
    await assert.rejects(
      start({ port }),
      (err) => err instanceof SiteError && err.message.includes(`port ${port} is already in use`) && /--port/.test(err.hint),
    );
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
});

test('close() resolves, even with an event stream open, and frees the port', async () => {
  const { server } = await start();
  const events = await openEvents(server);
  await waitFor(server.close(), 'close()');
  events.end();
  await assert.rejects(request(server, PAGE));
});
