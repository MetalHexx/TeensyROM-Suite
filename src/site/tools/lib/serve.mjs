import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { buildSite } from './build.mjs';
import { BASE_PATH, SiteError, paths } from './config.mjs';
import { DEV_CSS, DEV_JS, previewHtml } from './dev-client.mjs';

/** ReBeep's preview uses 8086, so both can run side by side. */
export const DEFAULT_PORT = 8087;
const HOST = '127.0.0.1';
const DEV = `${BASE_PATH}__dev/`;
const FONTS = `${DEV}fonts/`;
const PREVIEW = `${DEV}preview`;
const PREVIEW_HTML = previewHtml(BASE_PATH);
const FONT_TRIAL_DIR = path.join(paths.siteDir, 'tools', 'font-trial');
const DEBOUNCE_MS = 150;
const SILENT = { ok() {}, warn() {}, error() {} };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
};

const INJECTION = `<link rel="stylesheet" href="${DEV}dev.css">\n<script src="${DEV}dev.js" defer></script>\n`;

/** Adds the dev client just before the first `</head>`; html without one is returned as is. */
const inject = (html) => html.replace(/<\/head>/i, (closing) => `${INJECTION}${closing}`);

function send(req, res, status, type, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

const notFound = (req, res) => send(req, res, 404, MIME['.txt'], 'not found');

function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Content-Length': 0, 'Cache-Control': 'no-store' });
  res.end();
}

/** Maps the part of a request path after `prefix` to a file under `root`, or null when it would leave `root`. */
function resolveInside(root, requestPath, prefix) {
  let relative;
  try {
    relative = decodeURIComponent(requestPath.slice(prefix.length));
  } catch {
    return null;
  }
  if (relative.includes('\0')) return null;
  const target = path.resolve(root, relative);
  return target === root || target.startsWith(root + path.sep) ? target : null;
}

const statOrNull = (file) => fs.promises.stat(file).catch(() => null);

function listenError(err, port) {
  const hint = 'Stop whatever is using it, or pick another port with --port <n>.';
  if (err?.code === 'EADDRINUSE') return new SiteError(`port ${port} is already in use`, { hint });
  if (err?.code === 'EACCES') return new SiteError(`not allowed to listen on port ${port}`, { hint });
  return err;
}

/**
 * Builds the page from `src` into `out`, then serves it at `http://127.0.0.1:<port>/TeensyROM-Suite/`
 * (127.0.0.1 only) and rebuilds on every change under `src`, telling open pages to reload over
 * Server-Sent Events. The dev client is injected into served HTML only. `__dev/preview` shows the
 * page at desktop, tablet and phone widths side by side; `__dev/fonts/<file>` serves dev-only font
 * candidates from `src/site/tools/font-trial/`. Both are generated or read at request time, never part of
 * the build. `release` is stamped on every rebuild; a failed rebuild is logged and the last good
 * build keeps being served. Port 0 picks a free one. `log` is `{ ok, warn, error }`, silent by default.
 * Resolves to `{ url, previewUrl, port, out, stamped, close }`; `close()` stops the watcher, the open
 * event streams and the server.
 * @throws {SiteError} When the first build fails or the port is taken.
 */
export async function startSiteServer({
  src = paths.pageDir,
  out = paths.buildDir,
  release = null,
  port = DEFAULT_PORT,
  log,
  debounceMs = DEBOUNCE_MS,
} = {}) {
  const logger = { ...SILENT, ...log };
  const root = path.resolve(out);
  const watched = path.resolve(src);
  const built = buildSite({ src: watched, out: root, release });

  const clients = new Set();

  function events(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 1000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
  }

  async function serveFile(req, res, target, { page }) {
    let file = target;
    let stat = await statOrNull(file);
    if (stat?.isDirectory() && page) {
      if (!req.url.split(/[?#]/)[0].endsWith('/')) return redirect(res, `${req.url.split(/[?#]/)[0]}/`);
      file = path.join(file, 'index.html');
      stat = await statOrNull(file);
    }
    if (!stat?.isFile()) return notFound(req, res);
    const extension = path.extname(file).toLowerCase();
    const body = await fs.promises.readFile(file);
    const served = page && extension === '.html' ? inject(body.toString('utf8')) : body;
    return send(req, res, 200, MIME[extension] ?? 'application/octet-stream', served);
  }

  async function handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(req, res, 405, MIME['.txt'], 'method not allowed', { Allow: 'GET, HEAD' });
    }
    const requestPath = (req.url ?? '/').split(/[?#]/)[0];
    if (requestPath === '/' || requestPath === BASE_PATH.slice(0, -1)) return redirect(res, BASE_PATH);
    if (!requestPath.startsWith(BASE_PATH)) return notFound(req, res);
    if (requestPath.startsWith(DEV)) {
      if (requestPath === `${DEV}events`) return events(req, res);
      if (requestPath === `${DEV}dev.js`) return send(req, res, 200, MIME['.js'], DEV_JS);
      if (requestPath === `${DEV}dev.css`) return send(req, res, 200, MIME['.css'], DEV_CSS);
      if (requestPath === PREVIEW) return send(req, res, 200, MIME['.html'], PREVIEW_HTML);
      if (requestPath.startsWith(FONTS)) {
        const target = resolveInside(FONT_TRIAL_DIR, requestPath, FONTS);
        return target ? serveFile(req, res, target, { page: false }) : notFound(req, res);
      }
      return notFound(req, res);
    }
    const target = resolveInside(root, requestPath, BASE_PATH);
    return target ? serveFile(req, res, target, { page: true }) : notFound(req, res);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      logger.error(`${req.method} ${req.url}: ${err.message}`);
      if (res.headersSent) res.destroy();
      else send(req, res, 500, MIME['.txt'], 'server error');
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      server.off('error', reject);
      resolve();
    });
  }).catch((err) => {
    throw listenError(err, port);
  });
  server.on('error', (err) => logger.error(`server error: ${err.message}`));

  function rebuild() {
    try {
      buildSite({ src: watched, out: root, release });
    } catch (err) {
      logger.error(`rebuild failed, still serving the last good build: ${err.message}`);
      return;
    }
    logger.ok('rebuilt, reloading the page');
    for (const res of clients) res.write('event: reload\ndata: reload\n\n');
  }

  let timer = null;
  let watcher;
  try {
    watcher = fs.watch(watched, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(rebuild, debounceMs);
    });
  } catch (err) {
    await new Promise((resolve) => server.close(resolve));
    throw new SiteError(`cannot watch ${watched}: ${err.message}`);
  }
  watcher.on('error', (err) => logger.warn(`watching ${watched} failed: ${err.message}`));

  let closing = null;
  const close = () => {
    closing ??= (async () => {
      clearTimeout(timer);
      watcher.close();
      for (const res of clients) res.end();
      clients.clear();
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    })();
    return closing;
  };

  const boundPort = server.address().port;
  const origin = `http://${HOST}:${boundPort}`;
  return {
    url: `${origin}${BASE_PATH}`,
    previewUrl: `${origin}${PREVIEW}`,
    port: boundPort,
    out: built.out,
    stamped: built.stamped,
    close,
  };
}
