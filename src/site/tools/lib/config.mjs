import path from 'node:path';
import { fileURLToPath } from 'node:url';

export { SiteError } from './errors.mjs';

/** GitHub `owner/name` of this repo. */
export const SLUG = 'MetalHexx/TeensyROM-Suite';
/** Where Pages serves the site. */
export const BASE_PATH = '/TeensyROM-Suite/';
/** Public address of the page. */
export const SITE_URL = 'https://metalhexx.github.io/TeensyROM-Suite/';
/** The releases list on GitHub. */
export const RELEASES_URL = `https://github.com/${SLUG}/releases`;
/** Release regions the page must carry. */
export const REGIONS = ['hero', 'get'];
/** Package key -> asset suffix after the version (`TeensyROM-Suite-{version}-{suffix}`). */
export const PACKAGES = {
  windows: 'win-x64.zip',
  linux: 'linux-x64.tar.gz',
  pi: 'linux-arm64.tar.gz',
};
/** The GitHub API base; the only host that ever receives a token. */
export const DEFAULT_API_BASE = 'https://api.github.com';

const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = path.resolve(siteDir, '..', '..');

/** Absolute paths the toolchain works with. */
export const paths = {
  repoRoot,
  siteDir,
  pageDir: path.join(siteDir, 'page'),
  buildDir: path.join(siteDir, 'build'),
  versionProps: path.join(repoRoot, 'src', 'apps', 'Version.props'),
};
