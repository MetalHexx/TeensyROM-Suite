import fs from 'node:fs';
import path from 'node:path';
import { BASE_PATH, REGIONS, SITE_URL, SLUG, SiteError, paths } from './config.mjs';

/** Any one file in the build. */
export const FILE_LIMIT_BYTES = 400 * 1024;
/** The whole build. */
export const BUDGET_BYTES = 3 * 1024 * 1024;
/** What loads before any lazy picture. */
export const FIRST_SCREEN_BYTES = 500 * 1000;

const TEXT_EXTENSIONS = new Set([
  '.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.xml', '.webmanifest', '.vtt',
]);
const CODE_EXTENSIONS = new Set(['.html', '.css', '.js', '.mjs']);
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const kb = (bytes) => `${(bytes / 1000).toFixed(1)} KB`;
const extOf = (rel) => path.posix.extname(rel).toLowerCase();

const CSP_DIRECTIVES = {
  'default-src': "'self'",
  'img-src': "'self'",
  'style-src': "'self'",
  'script-src': "'self'",
  'font-src': "'self'",
  'frame-src': 'https://www.youtube-nocookie.com',
  'object-src': "'none'",
  'base-uri': "'none'",
  'form-action': "'none'",
};
const REFERRER_POLICY = 'strict-origin-when-cross-origin';

/**
 * Reads every file under `dir` into `{ rel, size, text }`, `rel` with forward slashes. `text` is
 * the file as UTF-8 for text types and null for anything else (images, fonts).
 * @param {string} dir
 * @returns {Array<{ rel: string, size: number, text: string | null }>}
 * @throws {SiteError} When `dir` is not a folder.
 */
export function readSiteFiles(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new SiteError(`there is no build at ${dir}`, { hint: 'Run `node site/tools/site.mjs build` first.' });
  }
  return fs
    .readdirSync(dir, { recursive: true })
    .map((rel) => String(rel).split(path.sep).join('/'))
    .filter((rel) => fs.statSync(path.join(dir, rel)).isFile())
    .sort()
    .map((rel) => {
      const full = path.join(dir, rel);
      return {
        rel,
        size: fs.statSync(full).size,
        text: TEXT_EXTENSIONS.has(extOf(rel)) ? fs.readFileSync(full, 'utf8') : null,
      };
    });
}

// ---- A small HTML tokenizer: tags and attributes, nothing more ----------------------------------

const COMMENT = /<!--[\s\S]*?-->/g;
const RAW_TEXT = /(<(script|style)\b[^>]*>)[\s\S]*?(<\/\2\s*>)/gi;
const TAG = /<([a-zA-Z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const ENTITIES = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>' };
const decode = (value) => value.replace(/&(?:amp|quot|#39|lt|gt);/g, (e) => ENTITIES[e]);

/**
 * Every start tag as `{ name, attrs, at, end, source }`: `name` lower-case, `attrs` a Map of
 * lower-case name to (entity-decoded) value, `at`/`end` the tag's span in `source`, the html with
 * comments removed and script and style bodies emptied.
 */
export function parseTags(html) {
  const source = html.replace(COMMENT, '').replace(RAW_TEXT, '$1$3');
  const tags = [];
  for (const m of source.matchAll(TAG)) {
    const attrs = new Map();
    for (const a of m[2].matchAll(ATTR)) {
      const name = a[1].toLowerCase();
      if (!attrs.has(name)) attrs.set(name, decode(a[2] ?? a[3] ?? a[4] ?? ''));
    }
    tags.push({ name: m[1].toLowerCase(), attrs, at: m.index, end: m.index + m[0].length, source });
  }
  return tags;
}

/** The text between a tag's end and the next `<`, trimmed (enough for `<title>`). */
const textAfter = (tag) => {
  const next = tag.source.indexOf('<', tag.end);
  return tag.source.slice(tag.end, next < 0 ? undefined : next).trim();
};

/** What a reader sees: the html without comments, script and style bodies, or any tag. */
function visibleText(html) {
  return html
    .replace(COMMENT, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/[a-zA-Z][^>]*>|<![^>]*>|<[a-zA-Z][^\s/>]*(?:[^>"']|"[^"]*"|'[^']*')*>/g, ' ');
}

const attrOf = (tag, name) => tag.attrs.get(name)?.trim() ?? '';
const relTokens = (tag) => attrOf(tag, 'rel').toLowerCase().split(/\s+/).filter(Boolean);
const metaKey = (tag) => (attrOf(tag, 'name') || attrOf(tag, 'property')).toLowerCase();
const metaContent = (page, key) =>
  page.tags.find((t) => t.name === 'meta' && metaKey(t) === key && attrOf(t, 'content') !== '');

// ---- Links ---------------------------------------------------------------------------------------

const isExternal = (url) => SCHEME.test(url) || url.startsWith('//');
const isWebUrl = (url) => /^(?:https?:)?\/\//i.test(url);

/** Every candidate URL of a `srcset` value. */
const srcsetUrls = (value) =>
  value.split(',').map((candidate) => candidate.trim().split(/\s+/)[0]).filter(Boolean);

/** Local references a tag makes: `src`, `href` and every `srcset` candidate. */
function references(tag) {
  const urls = [];
  for (const name of ['src', 'href']) if (tag.attrs.has(name)) urls.push(tag.attrs.get(name).trim());
  if (tag.attrs.has('srcset')) urls.push(...srcsetUrls(tag.attrs.get('srcset')));
  return urls.filter((url) => url !== '' && !url.startsWith('#') && !isExternal(url));
}

/**
 * Resolves a local `url` written in the file `from` against the set of built files. Returns
 * `{ file }` for the built file it names (a directory means its `index.html`), or `{ why }`.
 * The query and fragment are dropped.
 */
function resolveLocal(url, from, built) {
  const bare = url.split('#')[0].split('?')[0];
  if (bare === '') return { file: from };
  if (bare.startsWith('/')) return { why: `is root-absolute, which breaks under ${BASE_PATH}` };
  let decoded = bare;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    // keep the raw text: a bad escape simply will not match a file
  }
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), decoded));
  if (resolved === '..' || resolved.startsWith('../')) return { why: 'points outside the build' };
  let target = resolved.replace(/\/$/, '');
  if (target === '.') target = '';
  if (!decoded.endsWith('/') && target !== '' && built.has(target)) return { file: target };
  const index = target === '' ? 'index.html' : `${target}/index.html`;
  return built.has(index) ? { file: index } : { why: 'does not exist in the build' };
}

/** Local `url(...)` references in CSS, other than data URIs and fragments. */
function cssReferences(css) {
  const urls = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi)) {
    const url = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (url !== '' && !url.startsWith('#') && !isExternal(url)) urls.push(url);
  }
  return urls;
}

// ---- The first screen ----------------------------------------------------------------------------

/**
 * Bytes that load before any lazy picture, counted conservatively: `index.html`, its stylesheets and
 * scripts, the local `url()`s of those stylesheets, every icon and preload `<link>`, and every
 * `<img>` not marked `loading="lazy"` (its `src`, every `srcset` candidate and its `<picture>`'s).
 */
function firstScreenBytes(index, sizes, texts) {
  if (!index) return 0;
  const counted = new Set(['index.html']);
  const stylesheets = new Set();
  const add = (url, from) => {
    const found = resolveLocal(url, from, sizes);
    if (found.file) counted.add(found.file);
    return found.file;
  };
  const addAll = (urls) => {
    for (const url of urls) if (!isExternal(url) && url !== '') add(url, 'index.html');
  };

  for (const tag of index.tags) {
    if (tag.name === 'script' && tag.attrs.has('src')) addAll([attrOf(tag, 'src')]);
    if (tag.name !== 'link' || !tag.attrs.has('href')) continue;
    const rel = relTokens(tag);
    const href = attrOf(tag, 'href');
    if (rel.includes('stylesheet')) {
      if (!isExternal(href) && href !== '') {
        const file = add(href, 'index.html');
        if (file && extOf(file) === '.css') stylesheets.add(file);
      }
    } else if (rel.some((token) => token.includes('icon') || token.includes('preload'))) {
      addAll([href]);
    }
  }
  for (const css of stylesheets) {
    for (const url of cssReferences(texts.get(css) ?? '')) add(url, css);
  }

  const source = index.tags[0]?.source ?? '';
  const pictures = [...source.matchAll(/<picture\b[\s\S]*?<\/picture\s*>/gi)].map((m) => ({
    from: m.index,
    to: m.index + m[0].length,
  }));
  for (const img of index.tags.filter((t) => t.name === 'img' && attrOf(t, 'loading').toLowerCase() !== 'lazy')) {
    addAll(references(img));
    const picture = pictures.find((p) => img.at >= p.from && img.at < p.to);
    if (!picture) continue;
    for (const candidate of index.tags) {
      if (candidate.name === 'source' && candidate.at >= picture.from && candidate.at < picture.to) {
        addAll(references(candidate));
      }
    }
  }
  return [...counted].reduce((sum, rel) => sum + (sizes.get(rel) ?? 0), 0);
}

// ---- The checks ----------------------------------------------------------------------------------

const HTTP_URL = /http:\/\/(?!www\.w3\.org\/)[^\s"'<>)]*/gi;
const VERSION = /\bv?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/g;
const SOURCE_MARKER = /release:[A-Za-z0-9_-]+:(?:fallback|stamped|end)/;
const PROJECT_NAME = /\b[A-Z]{2,}[A-Z0-9]*(?:-[A-Z]{2,}[A-Z0-9]*)*-\d+\b(?!\.)/g;
const FORBIDDEN_WORD = /claude|anthropic/gi;
const RELEASE_DOWNLOAD = '/releases/download/';

/** A CSP value as a Map of directive to its tokens joined by single spaces. */
function parseCsp(content) {
  const directives = new Map();
  const problems = [];
  for (const part of content.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const name = tokens[0].toLowerCase();
    if (directives.has(name)) problems.push(`directive ${name} is given twice`);
    directives.set(name, tokens.slice(1).join(' '));
  }
  return { directives, problems };
}

function cspProblems(page) {
  const metas = page.tags.filter(
    (t) => t.name === 'meta' && attrOf(t, 'http-equiv').toLowerCase() === 'content-security-policy',
  );
  if (metas.length !== 1) {
    return [`${page.rel}: expected one Content-Security-Policy meta, found ${metas.length}`];
  }
  const { directives, problems } = parseCsp(metas[0].attrs.get('content') ?? '');
  for (const [name, value] of Object.entries(CSP_DIRECTIVES)) {
    if (!directives.has(name)) problems.push(`directive ${name} is missing (expected ${name} ${value})`);
    else if (directives.get(name) !== value) problems.push(`${name} is "${directives.get(name)}", expected "${value}"`);
  }
  for (const name of directives.keys()) {
    if (!(name in CSP_DIRECTIVES)) problems.push(`directive ${name} is not allowed`);
  }
  const mine = problems.map((p) => `${page.rel}: CSP ${p}`);
  const referrer = page.tags.some(
    (t) => t.name === 'meta' && attrOf(t, 'name').toLowerCase() === 'referrer' && attrOf(t, 'content') === REFERRER_POLICY,
  );
  if (!referrer) mine.push(`${page.rel}: no <meta name="referrer" content="${REFERRER_POLICY}">`);
  for (const tag of page.tags) {
    if (tag.name === 'style') mine.push(`${page.rel}: <style> element (the CSP forbids inline styles)`);
    if (tag.name === 'script' && !tag.attrs.has('src')) mine.push(`${page.rel}: <script> without src (the CSP forbids inline scripts)`);
    if (tag.attrs.has('style')) mine.push(`${page.rel}: <${tag.name}> has a style attribute`);
    for (const name of tag.attrs.keys()) {
      if (/^on[a-z]+$/.test(name)) mine.push(`${page.rel}: <${tag.name}> has an ${name} handler attribute`);
    }
  }
  return mine;
}

const REGION_CLOSE = (name) => `<!-- /release:${name} -->`;
const regionOpen = (name) =>
  new RegExp(`<!-- release:${name} state=(stamped|fallback)(?: tag=([^\\s>]+))? -->`, 'g');

/** The release regions of `index.html` and the tag they show; every region problem found. */
function releaseProblems(index, html) {
  const problems = [];
  for (const page of html) {
    if (page.text.includes('{{')) problems.push(`${page.rel}: contains an unfilled {{ placeholder`);
    if (SOURCE_MARKER.test(page.text)) problems.push(`${page.rel}: a source release marker (fallback, stamped or end) is left`);
  }
  if (!index) return problems;

  const found = [];
  for (const name of REGIONS) {
    const opens = [...index.text.matchAll(regionOpen(name))];
    const closes = index.text.split(REGION_CLOSE(name)).length - 1;
    if (opens.length !== 1 || closes !== 1) {
      problems.push(`index.html: region "${name}" has ${opens.length} opening and ${closes} closing markers, expected 1 each`);
      continue;
    }
    const [open] = opens;
    const from = open.index + open[0].length;
    const to = index.text.indexOf(REGION_CLOSE(name));
    if (to < from) {
      problems.push(`index.html: region "${name}" closes before it opens`);
      continue;
    }
    const tag = open[2] === undefined ? null : decode(open[2]);
    const content = index.text.slice(from, to);
    if (open[1] === 'stamped' && (open[2] === undefined || !content.includes(open[2]))) {
      problems.push(`index.html: stamped region "${name}" does not show its tag${tag ? ` ${tag}` : ''}`);
    }
    found.push({ name, state: open[1], tag });
  }

  const states = new Set(found.map((r) => r.state));
  if (states.size > 1) {
    problems.push(`index.html: regions disagree on state (${found.map((r) => `${r.name} is ${r.state}`).join(', ')})`);
  }
  const tags = new Set(found.filter((r) => r.state === 'stamped').map((r) => r.tag));
  if (tags.size > 1) {
    problems.push(`index.html: stamped regions show different tags (${found.map((r) => `${r.name} ${r.tag}`).join(', ')})`);
  }
  const shown = tags.size === 1 ? [...tags][0] : null;

  const prefix = `https://github.com/${SLUG}${RELEASE_DOWNLOAD}${shown}/`;
  for (const tag of index.tags) {
    for (const name of ['href', 'src']) {
      const url = attrOf(tag, name);
      if (!url.includes(RELEASE_DOWNLOAD)) continue;
      if (shown === null) problems.push(`index.html: ${url} is a download link but no release tag is shown`);
      else if (!url.startsWith(prefix)) problems.push(`index.html: ${url} is not under ${prefix}`);
    }
  }
  return problems;
}

/** Where the page text a version could hide in, with release regions, comments and SVG removed. */
function versionText(rel, text) {
  if (rel === 'index.html') {
    return text
      .replace(/<!-- release:([A-Za-z0-9_-]+) state=[\s\S]*?<!-- \/release:\1 -->/g, ' ')
      .replace(COMMENT, ' ')
      .replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, ' ');
  }
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\w])\/\/[^\n]*/g, '$1');
}

/** Wording problems in `text`, labelled `where`. */
function wordingProblems(text, where) {
  const problems = [];
  for (const m of text.matchAll(FORBIDDEN_WORD)) problems.push(`${where} names "${m[0]}"; the page never names an AI tool`);
  for (const m of text.matchAll(PROJECT_NAME)) problems.push(`${where} shows the internal project name "${m[0]}"`);
  return problems;
}

/** One entry per check: `{ id, title, run(ctx) -> string[] }`, a problem per string; none means pass. */
const CHECKS = [
  {
    id: 'entry',
    title: 'index.html is in the build',
    run: ({ built }) => (built.has('index.html') ? [] : ['index.html is missing']),
  },
  {
    id: 'weight',
    title: 'every file is under 400 KB, the build under 3 MB, the first screen under 500 KB',
    run: ({ files, bytes, firstScreen }) => {
      const problems = files
        .filter((f) => f.size > FILE_LIMIT_BYTES)
        .map((f) => `${f.rel} is ${kib(f.size)}, over the ${kib(FILE_LIMIT_BYTES)} file limit`);
      if (bytes > BUDGET_BYTES) problems.push(`the build is ${kib(bytes)}, over the ${kib(BUDGET_BYTES)} budget`);
      if (firstScreen > FIRST_SCREEN_BYTES) {
        problems.push(`the first screen is ${kb(firstScreen)}, over the ${kb(FIRST_SCREEN_BYTES)} budget`);
      }
      return problems;
    },
  },
  {
    id: 'links',
    title: 'every local src, href, srcset and url() resolves to a built file',
    run: ({ html, css, sizes }) => {
      const problems = [];
      for (const page of html) {
        for (const tag of page.tags) {
          for (const url of references(tag)) {
            const { why } = resolveLocal(url, page.rel, sizes);
            if (why) problems.push(`${page.rel}: <${tag.name}> ${url} ${why}`);
          }
        }
      }
      for (const file of css) {
        for (const url of cssReferences(file.text)) {
          const { why } = resolveLocal(url, file.rel, sizes);
          if (why) problems.push(`${file.rel}: url(${url}) ${why}`);
        }
      }
      return problems;
    },
  },
  {
    id: 'https',
    title: 'no http:// URLs in html, css or js',
    run: ({ code }) =>
      code.flatMap((f) => [...f.text.matchAll(HTTP_URL)].map((m) => `${f.rel}: ${m[0].slice(0, 80)}`)),
  },
  {
    id: 'images',
    title: 'every <img> has alt, width and height',
    run: ({ html }) =>
      html.flatMap((page) =>
        page.tags
          .filter((t) => t.name === 'img')
          .flatMap((t) => {
            const label = `${page.rel}: <img src="${t.attrs.get('src') ?? ''}">`;
            const problems = [];
            if (!t.attrs.has('alt')) problems.push(`${label} has no alt`);
            for (const name of ['width', 'height']) {
              if (!/^\d+$/.test(attrOf(t, name))) problems.push(`${label} has no numeric ${name}`);
            }
            return problems;
          }),
      ),
  },
  {
    id: 'h1',
    title: 'exactly one <h1> per page',
    run: ({ html }) =>
      html.flatMap((page) => {
        const count = page.tags.filter((t) => t.name === 'h1').length;
        return count === 1 ? [] : [`${page.rel}: ${count} <h1> elements`];
      }),
  },
  {
    id: 'csp',
    title: 'the content policy and referrer policy are set, with no inline style or script',
    run: ({ html }) => html.flatMap(cspProblems),
  },
  {
    id: 'dev',
    title: 'no __dev reference (the dev injection never ships)',
    run: ({ files }) => files.filter((f) => f.text?.includes('__dev')).map((f) => `${f.rel} mentions __dev`),
  },
  {
    id: 'release',
    title: 'the release regions agree, show their tag, and every download link matches it',
    run: ({ index, html }) => releaseProblems(index, html),
  },
  {
    id: 'version',
    title: 'no hand-written version outside the release regions',
    run: ({ files }) =>
      files
        .filter((f) => f.text !== null && (f.rel === 'index.html' || extOf(f.rel) === '.js'))
        .flatMap((f) =>
          [...versionText(f.rel, f.text).matchAll(VERSION)].map((m) => `${f.rel}: hand-written version "${m[0]}"`),
        ),
  },
  {
    id: 'head',
    title: '<html lang>, <title>, description and og:title/description/image/url are present',
    run: ({ html }) =>
      html.flatMap((page) => {
        const problems = [];
        const root = page.tags.find((t) => t.name === 'html');
        if (!root || attrOf(root, 'lang') === '') problems.push(`${page.rel}: <html> has no lang`);
        const title = page.tags.find((t) => t.name === 'title');
        if (!title || textAfter(title) === '') problems.push(`${page.rel}: no <title>`);
        for (const key of ['description', 'og:title', 'og:description', 'og:image', 'og:url']) {
          if (!metaContent(page, key)) problems.push(`${page.rel}: no <meta ${key.startsWith('og:') ? 'property' : 'name'}="${key}">`);
        }
        const url = metaContent(page, 'og:url');
        if (url && attrOf(url, 'content') !== SITE_URL) {
          problems.push(`${page.rel}: og:url is "${attrOf(url, 'content')}", expected "${SITE_URL}"`);
        }
        return problems;
      }),
  },
  {
    id: 'external',
    title: 'external links carry rel="noreferrer"',
    run: ({ html }) =>
      html.flatMap((page) =>
        page.tags
          .filter((t) => t.name === 'a' && isWebUrl(attrOf(t, 'href')) && !relTokens(t).includes('noreferrer'))
          .map((t) => `${page.rel}: ${attrOf(t, 'href')} has no rel="noreferrer"`),
      ),
  },
  {
    id: 'wording',
    title: 'the page never names an AI tool or an internal project',
    run: ({ html }) =>
      html.flatMap((page) => {
        const problems = wordingProblems(visibleText(page.text), `${page.rel}: text`);
        for (const tag of page.tags) {
          for (const name of ['alt', 'aria-label', 'title']) {
            if (tag.attrs.has(name)) problems.push(...wordingProblems(tag.attrs.get(name), `${page.rel}: ${name} "${tag.attrs.get(name).slice(0, 40)}"`));
          }
          const key = tag.name === 'meta' ? metaKey(tag) : '';
          if (key === 'description' || key.startsWith('og:') || key.startsWith('twitter:')) {
            problems.push(...wordingProblems(attrOf(tag, 'content'), `${page.rel}: ${key}`));
          }
        }
        return problems;
      }),
  },
];

/**
 * Runs every check over `files` (from `readSiteFiles`). Every check runs, so every failure is
 * reported.
 * @param {Array<{ rel: string, size: number, text: string | null }>} files
 * @returns {{ ok: boolean, checks: Array<{ id: string, title: string, ok: boolean, problems: string[] }>,
 *   files: number, bytes: number, firstScreenBytes: number }}
 */
export function checkSite(files) {
  const withText = files.filter((f) => f.text !== null);
  const html = withText
    .filter((f) => extOf(f.rel) === '.html')
    .map((f) => ({ rel: f.rel, text: f.text, tags: parseTags(f.text) }));
  const sizes = new Map(files.map((f) => [f.rel, f.size]));
  const index = html.find((page) => page.rel === 'index.html') ?? null;
  const bytes = files.reduce((sum, f) => sum + f.size, 0);
  const firstScreen = firstScreenBytes(index, sizes, new Map(withText.map((f) => [f.rel, f.text])));
  const ctx = {
    files,
    bytes,
    firstScreen,
    sizes,
    built: new Set(sizes.keys()),
    html,
    index,
    css: withText.filter((f) => extOf(f.rel) === '.css'),
    code: withText.filter((f) => CODE_EXTENSIONS.has(extOf(f.rel))),
  };
  const checks = CHECKS.map(({ id, title, run }) => {
    const problems = run(ctx);
    return { id, title, ok: problems.length === 0, problems };
  });
  return { ok: checks.every((c) => c.ok), checks, files: files.length, bytes, firstScreenBytes: firstScreen };
}

/** `readSiteFiles` then `checkSite` for the build folder `dir`. */
export const checkSiteDir = (dir = paths.buildDir) => checkSite(readSiteFiles(dir));

// ---- External links (local only) -----------------------------------------------------------------

const USER_AGENT = 'teensyrom-suite-site';
const EXTERNAL_TIMEOUT_MS = 10_000;
const EXTERNAL_CONCURRENCY = 4;

/**
 * Unique external `<a href>` targets worth asking the network about: web URLs other than those under
 * `SITE_URL` (the live site is not there until the first publish) and release downloads (the
 * `release` check covers those; the packages are huge). Fragments are dropped.
 */
export function externalTargets(files) {
  const urls = new Set();
  for (const f of files) {
    if (extOf(f.rel) !== '.html' || f.text === null) continue;
    for (const tag of parseTags(f.text)) {
      if (tag.name !== 'a') continue;
      const href = attrOf(tag, 'href');
      if (!isWebUrl(href)) continue;
      const url = (href.startsWith('//') ? `https:${href}` : href).split('#')[0];
      if (url.startsWith(SITE_URL) || url.includes(RELEASE_DOWNLOAD)) continue;
      urls.add(url);
    }
  }
  return [...urls].sort();
}

/** One request; the body is never read. Resolves to the status, or the error text. */
async function probe(url, method, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTERNAL_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    await res.body?.cancel().catch(() => {});
    return { status: res.status };
  } catch (err) {
    return { error: err?.name === 'AbortError' ? 'timed out' : (err?.cause?.code ?? err?.message ?? String(err)) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Asks the network about every external link of the build: HEAD first, GET when HEAD is refused.
 * @param {Array<{ rel: string, size: number, text: string | null }>} files
 * @param {{ fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<{ id: string, title: string, ok: boolean, problems: string[],
 *   results: Array<{ url: string, ok: boolean, detail: string }> }>}
 */
export async function checkExternalLinks(files, { fetchImpl = fetch } = {}) {
  const urls = externalTargets(files);
  const results = new Array(urls.length);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      let answer = await probe(urls[i], 'HEAD', fetchImpl);
      if (answer.error !== undefined || answer.status >= 400) answer = await probe(urls[i], 'GET', fetchImpl);
      const ok = answer.error === undefined && answer.status < 400;
      results[i] = { url: urls[i], ok, detail: answer.error ?? String(answer.status) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(EXTERNAL_CONCURRENCY, urls.length) }, worker));
  const problems = results.filter((r) => !r.ok).map((r) => `${r.url} answered ${r.detail}`);
  return {
    id: 'external-links',
    title: 'every external link answers',
    ok: problems.length === 0,
    problems,
    results,
  };
}
