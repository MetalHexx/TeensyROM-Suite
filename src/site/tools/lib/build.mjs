import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { REGIONS, SiteError, paths } from './config.mjs';

const MARKER = /<!-- release:([A-Za-z0-9_-]+):(fallback|stamped|end) -->/g;
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const PACKAGE_KEYS = ['windows', 'linux', 'pi'];
const PACKAGE_FIELDS = ['url', 'size'];
const PLACEHOLDERS = new Set([
  'tag',
  'version',
  'date',
  'dateText',
  'releaseUrl',
  ...PACKAGE_KEYS.flatMap((key) => PACKAGE_FIELDS.map((field) => `${key}.${field}`)),
]);

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** `2026-11-19` as `19 Nov 2026`. */
function formatDate(date) {
  const [year, month, day] = date.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

/** Decimal megabytes with one decimal: `48.2 MB`. */
function formatSize(bytes) {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

/** Placeholder name -> text value for a release. */
function valuesOf(release) {
  const values = {
    tag: release.tag,
    version: release.version,
    date: release.date,
    dateText: formatDate(release.date),
    releaseUrl: release.releaseUrl,
  };
  for (const key of PACKAGE_KEYS) {
    values[`${key}.url`] = release.packages[key].url;
    values[`${key}.size`] = formatSize(release.packages[key].size);
  }
  return values;
}

/** Every region's marker positions, keyed by region name. */
function scanMarkers(html) {
  const regions = new Map();
  for (const match of html.matchAll(MARKER)) {
    const [text, name, kind] = match;
    if (!regions.has(name)) regions.set(name, { fallback: [], stamped: [], end: [] });
    regions.get(name)[kind].push({ start: match.index, end: match.index + text.length });
  }
  return regions;
}

/** The three markers of one region, checked to be single and in order. */
function locateRegion(name, found) {
  const marks = found.get(name);
  if (!marks) {
    throw new SiteError(`the page has no release region "${name}"`, {
      hint: `Add <!-- release:${name}:fallback -->, <!-- release:${name}:stamped --> and <!-- release:${name}:end -->.`,
    });
  }
  for (const kind of ['fallback', 'stamped', 'end']) {
    if (marks[kind].length !== 1) {
      throw new SiteError(
        `release region "${name}" needs exactly one <!-- release:${name}:${kind} --> marker, found ${marks[kind].length}`,
      );
    }
  }
  const [fallback] = marks.fallback;
  const [stamped] = marks.stamped;
  const [end] = marks.end;
  if (!(fallback.start < stamped.start && stamped.start < end.start)) {
    throw new SiteError(`release region "${name}" markers must run fallback, stamped, end`);
  }
  return { name, fallback, stamped, end };
}

/** Fills the placeholders of a stamped variant; unknown names throw. */
function fillVariant(name, variant, values) {
  return variant.replace(PLACEHOLDER, (_, key) => {
    if (!PLACEHOLDERS.has(key)) {
      throw new SiteError(`release region "${name}" uses unknown placeholder {{${key}}}`, {
        hint: `Known placeholders: ${[...PLACEHOLDERS].join(', ')}.`,
      });
    }
    return values ? escapeHtml(values[key]) : '';
  });
}

/**
 * Resolves every release region. With a release the stamped variant is used, its placeholders
 * filled (HTML-escaped); without one the fallback variant is used. Each region comes out as
 * `<!-- release:NAME state=stamped tag=TAG -->` or `<!-- release:NAME state=fallback -->`, the
 * chosen variant, then `<!-- /release:NAME -->`.
 * @param {string} html
 * @param {import('./releases.mjs').PageRelease | null} release
 * @returns {string}
 * @throws {SiteError} On a missing, duplicated, misordered or unlisted region, an unknown
 *   placeholder, or a `{{` in a fallback variant.
 */
export function stampPage(html, release) {
  const found = scanMarkers(html);
  for (const name of found.keys()) {
    if (!REGIONS.includes(name)) {
      throw new SiteError(`the page has a release region "${name}" that is not in REGIONS`, {
        hint: 'Add it to REGIONS in src/site/tools/lib/config.mjs, or remove it from the page.',
      });
    }
  }
  const regions = REGIONS.map((name) => locateRegion(name, found)).sort(
    (a, b) => a.fallback.start - b.fallback.start,
  );
  for (let i = 1; i < regions.length; i++) {
    if (regions[i].fallback.start < regions[i - 1].end.end) {
      throw new SiteError(`release regions "${regions[i - 1].name}" and "${regions[i].name}" overlap`);
    }
  }

  const values = release ? valuesOf(release) : null;
  let out = '';
  let cursor = 0;
  for (const { name, fallback, stamped, end } of regions) {
    const fallbackText = html.slice(fallback.end, stamped.start);
    const stampedText = html.slice(stamped.end, end.start);
    if (fallbackText.includes('{{')) {
      throw new SiteError(`the fallback of release region "${name}" must not contain {{ placeholders`);
    }
    const filled = fillVariant(name, stampedText, values);
    const open = release
      ? `<!-- release:${name} state=stamped tag=${escapeHtml(release.tag)} -->`
      : `<!-- release:${name} state=fallback -->`;
    out += html.slice(cursor, fallback.start) + open + (release ? filled : fallbackText)
      + `<!-- /release:${name} -->`;
    cursor = end.end;
  }
  return out + html.slice(cursor);
}

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
}

/**
 * Copies `src` to a staging folder beside `out`, stamps its `index.html`, then swaps the result
 * in (remove `out`, rename staging to `out`), so a failed build leaves the last good build.
 * @param {{ src?: string, out?: string, release?: import('./releases.mjs').PageRelease | null }} [options]
 * @returns {{ out: string, stamped: boolean }}
 * @throws {SiteError} When `src` has no `index.html` or the page markup is wrong.
 */
export function buildSite({ src = paths.pageDir, out = paths.buildDir, release = null } = {}) {
  const indexName = 'index.html';
  if (!fs.existsSync(path.join(src, indexName))) {
    throw new SiteError(`${path.join(src, indexName)} does not exist`, {
      hint: 'Pass --src <dir> with an index.html in it.',
    });
  }
  const staging = `${out}.staging-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.cpSync(src, staging, { recursive: true });
    const indexFile = path.join(staging, indexName);
    fs.writeFileSync(indexFile, stampPage(fs.readFileSync(indexFile, 'utf8'), release));
    removeDir(out);
    fs.renameSync(staging, out);
  } finally {
    removeDir(staging);
  }
  return { out, stamped: Boolean(release) };
}
