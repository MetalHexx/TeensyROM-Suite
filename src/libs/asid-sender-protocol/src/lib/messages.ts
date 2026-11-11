import { isTeensyRomToken } from './teensyrom-token';
import type { SenderTimingReport } from './timing-report';

export const ASID_SENDER_IDENTITY = 'teensyrom-asid-sender';
export const ASID_SENDER_PROTOCOL_VERSION = 2;

/** The smallest and largest packet the sender accepts, in bytes. */
export const MIN_PACKET_BYTES = 3;
export const MAX_PACKET_BYTES = 1024;

/** The most wake alarms the sender holds armed at once. */
export const MAX_WAKE_ALARMS = 8;

const SYSEX_START = 0xf0;
const SYSEX_END = 0xf7;

/** Posted once by the parent through `window.postMessage`, with the channel's port transferred. */
export interface ConnectMessage {
  readonly k: 'connect';
  readonly identity: string;
  readonly version: number;
}

/** Everything the app sends over the connected `MessagePort`. */
export type AppToSender =
  | {
      readonly k: 'packet';
      readonly token: string;
      readonly bytes: Uint8Array;
      /** Shared clock; null = now. */
      readonly due: number | null;
    }
  | { readonly k: 'ping'; readonly seq: number }
  | { readonly k: 'test-arm'; readonly id: number }
  | {
      readonly k: 'test-end';
      readonly id: number;
      /** Shared clock. */
      readonly holdStart: number;
      /** Shared clock. */
      readonly holdEnd: number;
    }
  | { readonly k: 'timing'; readonly id: number }
  | { readonly k: 'timing-clear' }
  /** `at` is the shared clock. Replaces any wake armed under `id`. */
  | { readonly k: 'wake-at'; readonly id: number; readonly at: number }
  | { readonly k: 'wake-cancel'; readonly id: number };

/** Everything the sender sends back over the connected `MessagePort`. */
export type SenderToApp =
  /** At once, on the accepted connect. */
  | { readonly k: 'hello'; readonly identity: string; readonly version: number }
  /** Once MIDI access has resolved. */
  | { readonly k: 'ready'; readonly midi: boolean; readonly error?: string }
  | { readonly k: 'outputs'; readonly tokens: readonly string[] }
  | { readonly k: 'pong'; readonly seq: number }
  | { readonly k: 'test-armed'; readonly id: number }
  | { readonly k: 'test-result'; readonly id: number; readonly turns: number }
  | { readonly k: 'timing'; readonly id: number; readonly report: SenderTimingReport }
  | {
      readonly k: 'fault';
      readonly fault: 'midi-lost' | 'send-failed';
      readonly token?: string;
      readonly detail: string;
    }
  /** A due wake. `at` is the time asked for, `t` when the sender sent it; both the shared clock. */
  | { readonly k: 'wake'; readonly id: number; readonly at: number; readonly t: number };

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasNumbers(value: unknown, keys: readonly string[]): boolean {
  return isFields(value) && keys.every((key) => isNumber(value[key]));
}

function isWakeId(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isVisibility(value: unknown): boolean {
  return value === 'visible' || value === 'hidden';
}

function isPacket(value: Fields): boolean {
  const { bytes, due } = value;
  return (
    isTeensyRomToken(value['token']) &&
    bytes instanceof Uint8Array &&
    bytes.length >= MIN_PACKET_BYTES &&
    bytes.length <= MAX_PACKET_BYTES &&
    bytes[0] === SYSEX_START &&
    bytes[bytes.length - 1] === SYSEX_END &&
    (due === null || isNumber(due))
  );
}

/** A `connect` message with a string identity and a numeric version. */
export function isConnectMessage(value: unknown): value is ConnectMessage {
  return (
    isFields(value) &&
    value['k'] === 'connect' &&
    typeof value['identity'] === 'string' &&
    isNumber(value['version'])
  );
}

/**
 * An app message of a known kind with well-formed fields. A `packet` passes only when it is
 * valid: a token of the TeensyROM pattern, 3 to 1024 bytes that start with 0xF0 and end with
 * 0xF7, and a due time that is null or finite. A wake's `id` must be a positive safe integer.
 */
export function isAppToSender(value: unknown): value is AppToSender {
  if (!isFields(value)) {
    return false;
  }
  switch (value['k']) {
    case 'packet':
      return isPacket(value);
    case 'ping':
      return isNumber(value['seq']);
    case 'test-arm':
    case 'timing':
      return isNumber(value['id']);
    case 'test-end':
      return hasNumbers(value, ['id', 'holdStart', 'holdEnd']);
    case 'timing-clear':
      return true;
    case 'wake-at':
      return isWakeId(value['id']) && isNumber(value['at']);
    case 'wake-cancel':
      return isWakeId(value['id']);
    default:
      return false;
  }
}

function isLateness(value: unknown): boolean {
  return hasNumbers(value, ['count', 'p50', 'p99', 'max']);
}

function isCartridgeTiming(value: unknown): boolean {
  return (
    isFields(value) &&
    typeof value['token'] === 'string' &&
    hasNumbers(value, ['packets', 'failedSends', 'dropped']) &&
    hasNumbers(value['arrival'], [
      'pastDue',
      'pastDueMaxMs',
      'spareMinMs',
      'spareP1Ms',
      'spareP50Ms',
    ]) &&
    isLateness(value['send']) &&
    hasNumbers(value['send'], ['ownOver2Ms', 'ownOver5Ms', 'ownMaxMs']) &&
    hasNumbers(value['gaps'], ['medianMs', 'within1MsPct', 'offOver5Ms'])
  );
}

function isTimelineRow(value: unknown): boolean {
  return (
    isFields(value) &&
    hasNumbers(value, ['atS', 'marginMaxMs', 'wakeMaxMs']) &&
    isVisibility(value['visibility']) &&
    Array.isArray(value['cartridges']) &&
    value['cartridges'].every(
      (row) =>
        isFields(row) &&
        typeof row['token'] === 'string' &&
        hasNumbers(row, ['packets', 'pastDue', 'lateMaxMs', 'ownMaxMs', 'within1MsPct'])
    )
  );
}

function isTimingReport(value: unknown): value is SenderTimingReport {
  return (
    isFields(value) &&
    hasNumbers(value, ['sinceS', 'appQuietMaxMs']) &&
    hasNumbers(value['marginMs'], ['now', 'max']) &&
    isLateness(value['wake']) &&
    Array.isArray(value['cartridges']) &&
    value['cartridges'].every(isCartridgeTiming) &&
    Array.isArray(value['timeline']) &&
    value['timeline'].every(isTimelineRow) &&
    Array.isArray(value['visibility']) &&
    value['visibility'].every(
      (entry) => hasNumbers(entry, ['atS']) && isVisibility((entry as Fields)['state'])
    )
  );
}

/** A sender message of a known kind with well-formed fields. */
export function isSenderToApp(value: unknown): value is SenderToApp {
  if (!isFields(value)) {
    return false;
  }
  switch (value['k']) {
    case 'hello':
      return typeof value['identity'] === 'string' && isNumber(value['version']);
    case 'ready':
      return (
        typeof value['midi'] === 'boolean' &&
        (value['error'] === undefined || typeof value['error'] === 'string')
      );
    case 'outputs':
      return Array.isArray(value['tokens']) && value['tokens'].every(isTeensyRomToken);
    case 'pong':
      return isNumber(value['seq']);
    case 'test-armed':
      return isNumber(value['id']);
    case 'test-result':
      return hasNumbers(value, ['id', 'turns']);
    case 'timing':
      return isNumber(value['id']) && isTimingReport(value['report']);
    case 'fault':
      return (
        (value['fault'] === 'midi-lost' || value['fault'] === 'send-failed') &&
        (value['token'] === undefined || typeof value['token'] === 'string') &&
        typeof value['detail'] === 'string'
      );
    case 'wake':
      return isWakeId(value['id']) && hasNumbers(value, ['at', 't']);
    default:
      return false;
  }
}
