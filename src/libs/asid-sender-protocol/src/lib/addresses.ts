/** Where both servers serve the sender, under the app's other local name. */
export const ASID_SENDER_PATH = '/asid-sender/index.html';

const SENDER_ROOT = '/asid-sender';

/** True for '/asid-sender' and every path under '/asid-sender/'. */
export function isAsidSenderPath(pathname: string): boolean {
  return pathname === SENDER_ROOT || pathname.startsWith(`${SENDER_ROOT}/`);
}

/**
 * Calls `start` unless `pathname` is the sender's: a server's fallback copy of the app at that
 * address starts nothing.
 */
export function startUnlessSenderPath(pathname: string, start: () => void): void {
  if (!isAsidSenderPath(pathname)) {
    start();
  }
}

/** The other local name: 'localhost' ↔ '127.0.0.1'; null for any other host. */
export function otherLocalName(hostname: string): string | null {
  if (hostname === 'localhost') {
    return '127.0.0.1';
  }
  if (hostname === '127.0.0.1') {
    return 'localhost';
  }
  return null;
}

/**
 * Same scheme and port, the other local name: 'http://localhost:4200' → 'http://127.0.0.1:4200'.
 * Null when the host has no other local name. Symmetric, so the sender uses it to name the only
 * origin it accepts.
 */
export function pairedLocalOrigin(location: {
  protocol: string;
  hostname: string;
  port: string;
}): string | null {
  const other = otherLocalName(location.hostname);
  if (other === null) {
    return null;
  }
  const port = location.port === '' ? '' : `:${location.port}`;
  return `${location.protocol}//${other}${port}`;
}
