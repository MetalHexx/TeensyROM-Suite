import { Histogram } from '@teensyrom-nx/asid-sender-protocol';
import { ASID_MANUFACTURER_ID, ASID_MSG_SID_DATA, ASID_SYSEX_START } from '@sidablist/asid';

export type PressKind =
  | 'play'
  | 'stop'
  | 'pause'
  | 'jump'
  | 'play-now'
  | 'tempo'
  | 'mute'
  | 'knob'
  | 'hand-touch'
  | 'hand-move'
  | 'hand-lift';

export const PRESS_KINDS: readonly PressKind[] = [
  'play',
  'stop',
  'pause',
  'jump',
  'play-now',
  'tempo',
  'mute',
  'knob',
  'hand-touch',
  'hand-move',
  'hand-lift',
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
  readonly byKind: Partial<Record<PressKind, PressSummary>>;
  /** Every kind pooled; null with no reading. */
  readonly all: PressSummary | null;
  /** Readings timed from a controller message's arrival rather than from the mark. */
  readonly fromController: number;
  /** Marks that saw no carrying send within a second. */
  readonly noFrame: number;
  /** Marks replaced by the next press before a carrying send. */
  readonly superseded: number;
}

/** How long a mark waits for a carrying send before it counts as `noFrame`. */
const NO_FRAME_AFTER_MS = 1000;

const POOLED = PRESS_KINDS.length;
const HAND_MOVE = PRESS_KINDS.indexOf('hand-move');

/**
 * Bench instrumentation for one deck's press-to-wire time, built in dev builds only: from a press's
 * start to the moment the next frame the deck sends is stamped to leave (or is sent, if later) — the
 * delay the page, the tick and the lookahead set. A press from a controller starts when its message
 * arrived; any other starts when it is marked (`PressOrigin` decides). A press the engine holds on
 * purpose, such as a jump queued to a lap's end, reads the next frame, not its musical wait.
 *
 * One press is tracked at a time. A stop ends at any send, the ASID stop message; every other kind
 * ends at the first register-data message. A `'knob'` (a tune-shaping knob, the key among them) is
 * marked when the knob moves but only reaches the engine later, so it starts unapplied and a register
 * frame ends it only after `applied()`. A turn's ticks come faster than frames, so a tick that finds a
 * knob already pending joins it: the reading keeps the oldest tick, which waited longest, and the
 * frame that carries them reads it once.
 *
 * The hand's moves come as a stream, faster than frames, so they are tracked apart from the presses:
 * the first move after a carrying send is held, later moves leave it alone, and the next register
 * frame ends it. One reading per frame, of the oldest move it carries, which waited longest. A move
 * neither supersedes a press nor is superseded by one.
 *
 * `sent` runs on every frame the deck sends and allocates nothing; `read` allocates freely, on demand
 * from the console.
 */
export class PressProbe {
  private readonly histograms = Array.from(
    { length: PRESS_KINDS.length + 1 },
    () => new Histogram()
  );
  private readonly sums = new Float64Array(PRESS_KINDS.length + 1);
  private pending: PressKind | null = null;
  private armed = false;
  private startedAtMs = 0;
  private pendingFromController = false;
  private movePending = false;
  private moveStartedAtMs = 0;
  private moveFromController = false;
  private fromController = 0;
  private noFrame = 0;
  private superseded = 0;

  /**
   * A press of `kind`, marked at `nowMs`, that started at `startedAtMs` — earlier than `nowMs` when
   * it came from a controller message, which `fromController` says.
   */
  mark(kind: PressKind, nowMs: number, startedAtMs = nowMs, fromController = false): void {
    this.expire(nowMs);
    if (kind === 'hand-move') {
      if (!this.movePending) {
        this.movePending = true;
        this.moveStartedAtMs = startedAtMs;
        this.moveFromController = fromController;
      }
      return;
    }
    if (kind === 'knob' && this.pending === 'knob') {
      // A later tick of the same turn: the pending one keeps its start, its origin and its apply.
      return;
    }
    if (this.pending !== null) {
      this.superseded++;
    }
    this.pending = kind;
    this.armed = kind !== 'knob';
    this.startedAtMs = startedAtMs;
    this.pendingFromController = fromController;
  }

  /** The engine has taken the pending press (a knob's panel apply); from now on a carrying send can end it. */
  applied(): void {
    this.armed = true;
  }

  /** Every send from this deck's port façade, after the façade settles the stamp. */
  sent(bytes: Uint8Array, timestampMs: number | undefined, nowMs: number): void {
    if (this.pending === null && !this.movePending) {
      return;
    }
    this.expire(nowMs);
    const registers =
      bytes.length > 2 &&
      bytes[0] === ASID_SYSEX_START &&
      bytes[1] === ASID_MANUFACTURER_ID &&
      bytes[2] === ASID_MSG_SID_DATA;
    const leavesAtMs = timestampMs !== undefined && timestampMs > nowMs ? timestampMs : nowMs;

    if (this.pending !== null && this.armed && (this.pending === 'stop' || registers)) {
      this.record(
        PRESS_KINDS.indexOf(this.pending),
        leavesAtMs - this.startedAtMs,
        this.pendingFromController
      );
      this.pending = null;
    }
    if (this.movePending && registers) {
      this.record(HAND_MOVE, leavesAtMs - this.moveStartedAtMs, this.moveFromController);
      this.movePending = false;
    }
  }

  read(): PressReading {
    this.expire(performance.now());
    const byKind: Partial<Record<PressKind, PressSummary>> = {};
    PRESS_KINDS.forEach((kind, index) => {
      if (this.histograms[index].count > 0) {
        byKind[kind] = this.summary(index);
      }
    });
    return {
      byKind,
      all: this.histograms[POOLED].count > 0 ? this.summary(POOLED) : null,
      fromController: this.fromController,
      noFrame: this.noFrame,
      superseded: this.superseded,
    };
  }

  reset(): void {
    this.histograms.forEach((histogram) => histogram.reset());
    this.sums.fill(0);
    this.pending = null;
    this.armed = false;
    this.movePending = false;
    this.fromController = 0;
    this.noFrame = 0;
    this.superseded = 0;
  }

  /** Counts a mark that has waited too long for a carrying send as `noFrame` and drops it. A
   *  controller press waits from its arrival, so its second counts from there too. */
  private expire(nowMs: number): void {
    if (this.pending !== null && nowMs - this.startedAtMs > NO_FRAME_AFTER_MS) {
      this.noFrame++;
      this.pending = null;
    }
    if (this.movePending && nowMs - this.moveStartedAtMs > NO_FRAME_AFTER_MS) {
      this.noFrame++;
      this.movePending = false;
    }
  }

  private record(index: number, waitMs: number, fromController: boolean): void {
    this.histograms[index].add(waitMs);
    this.sums[index] += waitMs;
    this.histograms[POOLED].add(waitMs);
    this.sums[POOLED] += waitMs;
    if (fromController) {
      this.fromController++;
    }
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
