import { BINS_PER_MS, Histogram } from '@teensyrom-nx/asid-sender-protocol';

/** Spacing sends a probe keeps — about 80 s of a 2× tune's 100 Hz stream. */
const RING_SIZE = 8192;

/** The length of one timeline row, and how many rows a probe keeps (three hours). */
const ROW_MS = 10_000;
const MAX_ROWS = 1080;

/** Lag bucket upper edges, in ms; the last bucket is everything beyond the final edge. */
const LAG_EDGES_MS = [2, 5, 10, 15, 20, 30] as const;

/** Spacing bucket edges as a fraction of the frame interval. */
const COLLAPSED_BELOW = 0.25;
const BUNCHED_BELOW = 0.75;
const STRETCHED_ABOVE = 1.25;

export interface DeliveryProbeSummary {
  readonly frames: number;
  readonly intervalMs: number;
  /** How long after its due time each frame was handed to the port. */
  readonly lagMs: { readonly p50: number; readonly p90: number; readonly p99: number; readonly max: number };
  /** Percentage of frames per lag bucket, keyed by upper edge (`>30` for the rest). */
  readonly lagPct: Readonly<Record<string, number>>;
  /** Percentage of frames handed over at or past their timestamp — sent at once, not scheduled. */
  readonly missedWindowPct: number;
  /** How far apart consecutive frames were asked to land, against the frame interval. */
  readonly spacing: {
    readonly collapsedPct: number;
    readonly bunchedPct: number;
    readonly onGridPct: number;
    readonly stretchedPct: number;
    readonly minMs: number;
  };
}

/** One closed 10 s stretch of the lag: the second it closed at, its frames and its lag. */
export interface LagTimelineRow {
  readonly atS: number;
  readonly frames: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

/**
 * Bench instrumentation for one deck's frame delivery, built in dev builds only. `DeckRuntime`'s
 * port façade hands it every timestamped send, and it records two things per frame: how late the
 * frame reached the port against the time it fell due, and how far apart it was asked to land from
 * the frame before. A timestamp already in the past goes out at once, so a frame lands at the later
 * of its timestamp and the moment it was sent.
 *
 * The lag goes into a histogram that covers everything since the last `reset`, however long, and
 * into a second one per 10 s timeline row, so a stall shows where it landed. The spacing keeps
 * the last 8,192 sends.
 *
 * `record` allocates nothing — a histogram, a ring, typed arrays and counters — because it runs on
 * the path whose jitter it measures. `summarize` and `lagTimeline` allocate freely; they run on
 * demand from the console.
 */
export class DeliveryProbe {
  private readonly lagHistogram = new Histogram();
  private readonly rowHistogram = new Histogram();
  private readonly rowAtS = new Uint32Array(MAX_ROWS);
  private readonly rowFrames = new Uint32Array(MAX_ROWS);
  private readonly rowP99Ms = new Float32Array(MAX_ROWS);
  private readonly rowMaxMs = new Float32Array(MAX_ROWS);
  private rows = 0;
  /** How many 10 s rows, counted from the first send after a reset, have closed or been skipped. */
  private rowsPassed = 0;
  private firstSendMs = Number.NaN;
  private readonly spacingMs = new Float32Array(RING_SIZE);
  private sends = 0;
  private lastLandsAtMs = Number.NaN;
  private scheduleAheadMs = 0;

  /** The sink's effective schedule-ahead, which turns a send's timestamp back into its due time.
   *  Readings in progress are kept: later frames are measured against the new value. */
  setScheduleAhead(ms: number): void {
    this.scheduleAheadMs = ms;
  }

  record(timestampMs: number): void {
    const nowMs = performance.now();
    if (Number.isNaN(this.firstSendMs)) {
      this.firstSendMs = nowMs;
    }
    this.closeRowsUpTo(nowMs);
    const landsAtMs = timestampMs > nowMs ? timestampMs : nowMs;
    const lagMs = nowMs - (timestampMs - this.scheduleAheadMs);
    this.lagHistogram.add(lagMs);
    this.rowHistogram.add(lagMs);
    // NaN for the first send after a reset; `summarize` skips it.
    this.spacingMs[this.sends % RING_SIZE] = landsAtMs - this.lastLandsAtMs;
    this.lastLandsAtMs = landsAtMs;
    this.sends++;
  }

  reset(): void {
    this.lagHistogram.reset();
    this.rowHistogram.reset();
    this.rows = 0;
    this.rowsPassed = 0;
    this.firstSendMs = Number.NaN;
    this.sends = 0;
    this.lastLandsAtMs = Number.NaN;
  }

  /** The closed 10 s rows since the last reset, oldest first; the stretch still open is left out. */
  lagTimeline(): LagTimelineRow[] {
    return Array.from({ length: this.rows }, (_, row) => ({
      atS: this.rowAtS[row],
      frames: this.rowFrames[row],
      p99Ms: round(this.rowP99Ms[row]),
      maxMs: round(this.rowMaxMs[row]),
    }));
  }

  summarize(intervalMs: number): DeliveryProbeSummary {
    const lag = this.lagHistogram;
    const count = lag.count;
    const spacings = Array.from(this.spacingMs.subarray(0, Math.min(this.sends, RING_SIZE))).filter(
      Number.isFinite
    );

    const lagPct: Record<string, number> = {};
    let fromBin = 0;
    let below = 0;
    for (const edge of LAG_EDGES_MS) {
      const toBin = edge * BINS_PER_MS;
      const within = lag.countBetween(fromBin, toBin);
      lagPct[`≤${edge}`] = pct(within, count);
      below += within;
      fromBin = toBin + 1;
    }
    lagPct[`>${LAG_EDGES_MS[LAG_EDGES_MS.length - 1]}`] = pct(count - below, count);

    let collapsed = 0;
    let bunched = 0;
    let stretched = 0;
    for (const spacing of spacings) {
      const ratio = spacing / intervalMs;
      if (ratio < COLLAPSED_BELOW) collapsed++;
      else if (ratio < BUNCHED_BELOW) bunched++;
      else if (ratio > STRETCHED_ABOVE) stretched++;
    }

    const missedFromBin = Math.max(0, Math.floor(this.scheduleAheadMs * BINS_PER_MS));
    return {
      frames: count,
      intervalMs: round(intervalMs),
      lagMs: {
        p50: round(lag.percentile(0.5)),
        p90: round(lag.percentile(0.9)),
        p99: round(lag.percentile(0.99)),
        max: round(lag.max),
      },
      lagPct,
      missedWindowPct: pct(count - lag.countBetween(0, missedFromBin - 1), count),
      spacing: {
        collapsedPct: pct(collapsed, spacings.length),
        bunchedPct: pct(bunched, spacings.length),
        onGridPct: pct(spacings.length - collapsed - bunched - stretched, spacings.length),
        stretchedPct: pct(stretched, spacings.length),
        minMs: round(spacings.length === 0 ? 0 : Math.min(...spacings)),
      },
    };
  }

  /** Closes the timeline rows that ended before `nowMs`; stretches with no frame close as empty
   *  rows. Past the cap the rest are skipped, not stored. */
  private closeRowsUpTo(nowMs: number): void {
    const due = Math.floor((nowMs - this.firstSendMs) / ROW_MS);
    while (this.rowsPassed < due) {
      if (this.rows === MAX_ROWS) {
        this.rowsPassed = due;
        break;
      }
      this.rowAtS[this.rows] = ((this.rowsPassed + 1) * ROW_MS) / 1000;
      this.rowFrames[this.rows] = this.rowHistogram.count;
      this.rowP99Ms[this.rows] = this.rowHistogram.percentile(0.99);
      this.rowMaxMs[this.rows] = this.rowHistogram.max;
      this.rows++;
      this.rowsPassed++;
      this.rowHistogram.reset();
    }
  }
}

function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
