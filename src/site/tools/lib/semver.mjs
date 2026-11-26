const IDENT = String.raw`(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)`;
const PATTERN = new RegExp(
  String.raw`^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)`
    + `(?:-(${IDENT}(?:\\.${IDENT})*))?`
    + String.raw`(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$`,
);

/**
 * @typedef {{ major: number, minor: number, patch: number, pre: string }} SemVer
 */

/**
 * Reads `1.2.3`, `v1.2.3-beta.1` or `1.2.3+abc` (build metadata is dropped).
 * @param {unknown} text
 * @returns {SemVer | null} null for anything that is not a SemVer 2 version.
 */
export function parseSemVer(text) {
  if (typeof text !== 'string') return null;
  const match = PATTERN.exec(text.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ?? '',
  };
}

/**
 * Whether the version carries a `-suffix`.
 * @param {SemVer} version
 * @returns {boolean}
 */
export function isPreRelease(version) {
  return version.pre !== '';
}

/**
 * `1.2.3` or `1.2.3-beta.1`, without a leading `v`.
 * @param {SemVer} version
 * @returns {string}
 */
export function formatSemVer(version) {
  const core = `${version.major}.${version.minor}.${version.patch}`;
  return isPreRelease(version) ? `${core}-${version.pre}` : core;
}

const isNumeric = (part) => /^\d+$/.test(part);
const sign = (n) => (n < 0 ? -1 : n > 0 ? 1 : 0);
const ordinal = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function comparePart(left, right) {
  const leftNumeric = isNumeric(left);
  const rightNumeric = isNumeric(right);
  if (leftNumeric && rightNumeric) {
    return left.length !== right.length ? sign(left.length - right.length) : ordinal(left, right);
  }
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  return ordinal(left, right);
}

function comparePreRelease(left, right) {
  const leftParts = left.split('.');
  const rightParts = right.split('.');
  const shared = Math.min(leftParts.length, rightParts.length);
  for (let i = 0; i < shared; i++) {
    const order = comparePart(leftParts[i], rightParts[i]);
    if (order !== 0) return order;
  }
  return sign(leftParts.length - rightParts.length);
}

/**
 * SemVer 2 section 11 precedence.
 * @param {SemVer} a
 * @param {SemVer} b
 * @returns {-1 | 0 | 1}
 */
export function compareSemVer(a, b) {
  const core = sign(a.major - b.major) || sign(a.minor - b.minor) || sign(a.patch - b.patch);
  if (core !== 0) return core;
  if (isPreRelease(a) !== isPreRelease(b)) return isPreRelease(a) ? -1 : 1;
  return isPreRelease(a) ? comparePreRelease(a.pre, b.pre) : 0;
}
