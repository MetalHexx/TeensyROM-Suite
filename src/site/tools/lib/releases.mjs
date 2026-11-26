import fs from 'node:fs';
import { DEFAULT_API_BASE, PACKAGES, SLUG, SiteError, paths } from './config.mjs';
import { compareSemVer, isPreRelease, parseSemVer } from './semver.mjs';

const PUBLISHED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * @typedef {{ name: string, url: string, size: number }} PagePackage
 * @typedef {{
 *   tag: string,
 *   version: string,
 *   date: string,
 *   releaseUrl: string,
 *   packages: { windows: PagePackage, linux: PagePackage, pi: PagePackage },
 * }} PageRelease
 */

/**
 * The GitHub API base and token for a lookup. `SITE_GITHUB_API` overrides the base (tests and
 * local use); the token comes from `GITHUB_TOKEN` or `GH_TOKEN`.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ apiBase: string, token: string | undefined }}
 */
export function githubApi(env = process.env) {
  return {
    apiBase: env.SITE_GITHUB_API || DEFAULT_API_BASE,
    token: env.GITHUB_TOKEN || env.GH_TOKEN || undefined,
  };
}

/**
 * GET {apiBase}/repos/{SLUG}/releases?per_page=30 (the same list `trom update` reads). The token
 * is sent only to the default api.github.com. Never throws.
 * @param {{ apiBase?: string, token?: string, timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: true, releases: unknown[] } | { ok: false, reason: string }>}
 */
export async function fetchReleases({ apiBase = DEFAULT_API_BASE, token, timeoutMs = 10000 } = {}) {
  const base = apiBase.replace(/\/+$/, '');
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'teensyrom-suite-site',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token && base === DEFAULT_API_BASE) headers.Authorization = `Bearer ${token}`;

  let body;
  try {
    const res = await fetch(`${base}/repos/${SLUG}/releases?per_page=30`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, reason: `${base} answered HTTP ${res.status}` };
    body = await res.json();
  } catch (err) {
    if (err?.name === 'TimeoutError') {
      return { ok: false, reason: `${base} did not answer within ${timeoutMs} ms` };
    }
    if (err instanceof SyntaxError) {
      return { ok: false, reason: `${base} sent a response that is not JSON` };
    }
    const why = err?.cause?.code ?? err?.message ?? 'network error';
    return { ok: false, reason: `cannot reach ${base} (${why})` };
  }
  if (!Array.isArray(body)) return { ok: false, reason: `${base} did not send a list of releases` };
  return { ok: true, releases: body };
}

/** Published releases with a SemVer tag, each with its parsed version. */
function candidates(releases) {
  const found = [];
  for (const item of Array.isArray(releases) ? releases : []) {
    if (item === null || typeof item !== 'object' || item.draft === true) continue;
    const version = parseSemVer(item.tag_name);
    if (version) found.push({ item, version });
  }
  return found;
}

/** The release as the page shows it, or the reason it cannot be shown. */
function toPageRelease({ item }) {
  const tag = item.tag_name.trim();
  const plain = tag.replace(/^v/, '');
  const publishedAt = item.published_at;
  const published = typeof publishedAt === 'string' && PUBLISHED_AT.test(publishedAt)
    ? Date.parse(publishedAt)
    : Number.NaN;
  if (Number.isNaN(published)) return { reason: `${tag} has no valid published_at` };

  const prefix = `https://github.com/${SLUG}/releases/download/${tag}/`;
  const assets = Array.isArray(item.assets) ? item.assets : [];
  const packages = {};
  for (const [key, suffix] of Object.entries(PACKAGES)) {
    const name = `TeensyROM-Suite-${plain}-${suffix}`;
    const asset = assets.find((a) => a !== null && typeof a === 'object' && a.name === name);
    if (!asset) return { reason: `${tag} has no ${name}` };
    const url = asset.browser_download_url;
    if (typeof url !== 'string' || !url.startsWith(prefix)) {
      return { reason: `${tag} has ${name} outside ${prefix}` };
    }
    if (typeof asset.size !== 'number' || !Number.isFinite(asset.size) || asset.size < 0) {
      return { reason: `${tag} has ${name} without a size` };
    }
    packages[key] = { name, url, size: asset.size };
  }
  return {
    release: {
      tag,
      version: plain,
      date: new Date(published).toISOString().slice(0, 10),
      releaseUrl: `https://github.com/${SLUG}/releases/tag/${tag}`,
      packages,
    },
  };
}

const highest = (entries) =>
  entries.reduce((top, next) => (compareSemVer(next.version, top.version) > 0 ? next : top));

/**
 * Picks the release the page shows: among usable releases the highest stable one, or when none is
 * stable the highest pre-release. Pre-release comes from the version alone; GitHub's `prerelease`
 * flag is ignored. Never throws.
 * @param {unknown[]} releases
 * @returns {{ release: PageRelease, passedOver: string[] } | { fallback: string, passedOver: string[] }}
 */
export function selectRelease(releases) {
  const passedOver = [];
  const usable = [];
  for (const candidate of candidates(releases)) {
    const result = toPageRelease(candidate);
    if (result.release) usable.push({ release: result.release, version: candidate.version });
    else passedOver.push(result.reason);
  }
  if (usable.length === 0) {
    return { fallback: 'no published release has all three packages', passedOver };
  }
  const stable = usable.filter((u) => !isPreRelease(u.version));
  return { release: highest(stable.length > 0 ? stable : usable).release, passedOver };
}

/**
 * Highest SemVer among published (non-draft) releases with a SemVer tag, packages or not.
 * @param {unknown[]} releases
 * @returns {string | null} The tag, or null when there is none.
 */
export function newestPublished(releases) {
  const all = candidates(releases);
  return all.length === 0 ? null : highest(all).item.tag_name.trim();
}

/**
 * Whether a publish may go out now: only when `Version.props` is not ahead of the newest published
 * release, so the page never gets ahead of the download. Throws a SiteError for a non-SemVer
 * `propsVersion`.
 * @param {{ propsVersion: string, releases: unknown[] }} input
 * @returns {{ publish: boolean, reason: string, newest: string | null }}
 */
export function decideGate({ propsVersion, releases }) {
  const props = parseSemVer(propsVersion);
  if (!props) throw new SiteError(`Version.props version "${propsVersion}" is not SemVer`);
  const newest = newestPublished(releases);
  if (newest === null) {
    return {
      publish: false,
      reason: `held: Version.props ${propsVersion} has no published release to match; the page goes live when one is published`,
      newest,
    };
  }
  if (compareSemVer(props, parseSemVer(newest)) > 0) {
    return {
      publish: false,
      reason: `held: Version.props ${propsVersion} is ahead of the newest release ${newest}; the page goes live when that release is published`,
      newest,
    };
  }
  return {
    publish: true,
    reason: `Version.props ${propsVersion} is not ahead of the newest release ${newest}`,
    newest,
  };
}

/**
 * `<Version>` from `src/apps/Version.props`.
 * @param {string} [file]
 * @returns {string}
 * @throws {SiteError} When the file is unreadable, has no `<Version>`, or it is not SemVer.
 */
export function readPropsVersion(file = paths.versionProps) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new SiteError(`cannot read ${file}: ${err.message}`);
  }
  const match = /<Version>\s*([^<]*?)\s*<\/Version>/.exec(text);
  if (!match) throw new SiteError(`${file} has no <Version>`);
  if (!parseSemVer(match[1])) throw new SiteError(`${file} <Version> "${match[1]}" is not SemVer`);
  return match[1];
}
