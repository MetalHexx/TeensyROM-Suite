import { Histogram } from '@teensyrom-nx/asid-sender-protocol';
import { ASID_MSG_SID_DATA } from '@sidablist/asid';

export type PressKind = 'play' | 'stop' | 'pause' | 'jump' | 'play-now' | 'tempo' | 'mute' | 'nudge';

export const PRESS_KINDS: readonly PressKind[] = [
  'play',
  'stop',
  'pause',
  'jump',
  'play-now',
  'tempo',
  'mute',
  'nudge',
];

export interface PressSummary {
  readonly count: number;
  readonly mean: number;
  readonly p50: number;
  readonly p99: number;
  readonly max: number;
}

export interface PressReading {
  /** Press-to-wire per kind, in ms; kinds with no reading are left out. */
  readonly presses: Partial<Record<PressKind, PressSummary>>;
  /** Every kind pooled; null with no reading. */
  readonly all: PressSummary | null;
  /** Marks that saw no carrying send within a second. */
  readonly noFrame: number;
  /** Marks replaced by the next press before a carrying send. */
  readonly superseded: number;
}

/** How long a mark waits for a carrying send before it counts as `noFrame`. */
const NO_FRAME_AFTER_MS = 1000;

/** What opens an ASID register-data message: the manufacturer id, then the message type. */
const ASID_ID_0 = 0xf0;
const ASID_ID_1 = 0x2d;

const POOLED = PRESS_KINDS.length;

/**
 * Bench instrumentation for one deck's press-to-wire time, built in dev builds only: from a press
 * reaching the deck's engine to the moment the next frame the deck sends is stamped to leave (or is
 * sent, if later) — the delay the tick and the lookahead set. A press the engine holds on purpose,
 * such as a jump queued to a lap's end, reads the next frame, not its musical wait.
 *
 * One press is tracked at a time. A stop ends at any send, the ASID stop message; every other kind
 * ends at the first register-data message. A `'nudge'` is marked when the knob moves but only reaches
 * the engine later, so it starts unapplied and a register frame ends it only after `applied()`.
 *
 * `sent` runs on every frame the deck sends and allocates nothing; `read` allocates freely, on demand
 * from the console.
 */
export class PressProbe {
  private readonly histograms = Array.from({ length: PRESS_KINDS.length + 1 }, () => new Histogram());
  private readonly sums = new Float64Array(PRESS_KINDS.length + 1);
  private pending: PressKind | null = null;
  private armed = false;
  private markedAtMs = 0;
  private noFrame = 0;
  private superseded = 0;

  mark(kind: PressKind, nowMs: number): void {
    this.expire(nowMs);
    if (this.pending !== null) {
      this.superseded++;
    }
    this.pending = kind;
    this.armed = kind !== 'nudge';
    this.markedAtMs = nowMs;
  }

  /** The engine has taken the pending press (a nudge's panel apply); from now on a carrying send can end it. */
  applied(): void {
    this.armed = true;
  }

  /** Every send from this deck's port façade, after the façade settles the stamp. */
  sent(bytes: Uint8Array, timestampMs: number | undefined, nowMs: number): void {
    if (this.pending === null) {
      return;
    }
    this.expire(nowMs);
    if (this.pending === null || !this.armed) {
      return;
    }
    const carries =
      this.pending === 'stop' ||
      (bytes.length > 2 &&
        bytes[0] === ASID_ID_0 &&
        bytes[1] === ASID_ID_1 &&
        bytes[2] === ASID_MSG_SID_DATA);
    if (!carries) {
      return;
    }
    const leavesAtMs = timestampMs !== undefined && timestampMs > nowMs ? timestampMs : nowMs;
    const waitMs = leavesAtMs - this.markedAtMs;
    this.record(PRESS_KINDS.indexOf(this.pending), waitMs);
    this.record(POOLED, waitMs);
    this.pending = null;
  }

  read(): PressReading {
    this.expire(performance.now());
    const presses: Partial<Record<PressKind, PressSummary>> = {};
    PRESS_KINDS.forEach((kind, index) => {
      if (this.histograms[index].count > 0) {
        presses[kind] = this.summary(index);
      }
    });
    return {
      presses,
      all: this.histograms[POOLED].count > 0 ? this.summary(POOLED) : null,
      noFrame: this.noFrame,
      superseded: this.superseded,
    };
  }

  reset(): void {
    this.histograms.forEach((histogram) => histogram.reset());
    this.sums.fill(0);
    this.pending = null;
    this.armed = false;
    this.noFrame = 0;
    this.superseded = 0;
  }

  /** Counts a mark that has waited too long as `noFrame` and drops it. */
  private expire(nowMs: number): void {
    if (this.pending !== null && nowMs - this.markedAtMs > NO_FRAME_AFTER_MS) {
      this.noFrame++;
      this.pending = null;
    }
  }

  private record(index: number, waitMs: number): void {
    this.histograms[index].add(waitMs);
    this.sums[index] += waitMs;
  }

  private summary(index: number): PressSummary {
    const histogram = this.histograms[index];
    return {
      count: histogram.count,
      mean: round(this.sums[index] / histogram.count),
      p50: round(histogram.percentile(0.5)),
      p99: round(histogram.percentile(0.99)),
      max: round(histogram.max),
    };
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
