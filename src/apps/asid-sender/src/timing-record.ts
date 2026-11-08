import type {
  CartridgeTiming,
  LatenessSummary,
  SenderTimingReport,
  TimelineRow,
} from '@teensyrom-nx/asid-sender-protocol';
import type { HeldPacket } from './release-queue';

type Visibility = 'visible' | 'hidden';

const BINS_PER_MS = 10;
const RANGE_MS = 100;
const BIN_COUNT = RANGE_MS * BINS_PER_MS;
const WITHIN_1MS_BINS = 1 * BINS_PER_MS;
const OFF_5MS_BINS = 5 * BINS_PER_MS;

export const ROW_MS = 10_000;
export const MAX_CARTRIDGES = 8;
export const TIMELINE_ROWS = 1080;
export const VISIBILITY_ENTRIES = 256;

const round = (value: number, places: number): number => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

/**
 * Counts of values in 0.1 ms bins over 0 to 100 ms, plus an overflow bin, in one array allocated
 * once. The count, the smallest and the largest value are exact; a percentile is good to its bin,
 * and one that lands in the overflow bin reports the largest value.
 */
export class Histogram {
  readonly bins = new Uint32Array(BIN_COUNT + 1);
  count = 0;
  min = Infinity;
  max = 0;

  add(value: number): void {
    const bin = value <= 0 ? 0 : Math.min(BIN_COUNT, Math.floor(value * BINS_PER_MS));
    this.bins[bin]++;
    this.count++;
    this.min = Math.min(this.min, value);
    this.max = Math.max(this.max, value);
  }

  reset(): void {
    this.bins.fill(0);
    this.count = 0;
    this.min = Infinity;
    this.max = 0;
  }

  /** The bin holding the value at rank `floor(p × count)`; the same pick as indexing a sorted list. */
  binAt(p: number): number {
    const rank = Math.min(this.count - 1, Math.floor(p * this.count));
    let seen = 0;
    for (let bin = 0; bin <= BIN_COUNT; bin++) {
      seen += this.bins[bin];
      if (seen > rank) {
        return bin;
      }
    }
    return BIN_COUNT;
  }

  /** The middle of a bin; the largest value for the overflow bin. */
  valueOf(bin: number): number {
    return bin >= BIN_COUNT ? this.max : (bin + 0.5) / BINS_PER_MS;
  }

  percentile(p: number): number {
    return this.count === 0 ? 0 : this.valueOf(this.binAt(p));
  }

  /** The count in bins `from` to `to`, both inclusive and clipped to the array. */
  countBetween(from: number, to: number): number {
    let total = 0;
    for (let bin = Math.max(0, from); bin <= Math.min(BIN_COUNT, to); bin++) {
      total += this.bins[bin];
    }
    return total;
  }
}

interface GapStats {
  medianMs: number;
  within1MsPct: number;
  offOver5Ms: number;
}

/** The median gap, the share of gaps within 1 ms of it, and how many are more than 5 ms off it. */
function gapStats(gaps: Histogram): GapStats {
  if (gaps.count === 0) {
    return { medianMs: 0, within1MsPct: 0, offOver5Ms: 0 };
  }
  const middle = gaps.binAt(0.5);
  const within = gaps.countBetween(middle - WITHIN_1MS_BINS, middle + WITHIN_1MS_BINS);
  const near = gaps.countBetween(middle - OFF_5MS_BINS, middle + OFF_5MS_BINS);
  return {
    medianMs: round(gaps.valueOf(middle), 2),
    within1MsPct: round((100 * within) / gaps.count, 1),
    offOver5Ms: gaps.count - near,
  };
}

class CartridgeRecord {
  token = '';
  lastActiveMs = 0;

  packets = 0;
  pastDue = 0;
  pastDueMaxMs = 0;
  ownOver2Ms = 0;
  ownOver5Ms = 0;
  ownMaxMs = 0;
  failedSends = 0;
  dropped = 0;
  lastSendMs: number | null = null;

  readonly spare = new Histogram();
  readonly late = new Histogram();
  readonly gaps = new Histogram();

  rowPackets = 0;
  rowPastDue = 0;
  rowLateMaxMs = 0;
  rowOwnMaxMs = 0;
  /** The open row's gaps; reset when the row closes. */
  readonly rowGaps = new Histogram();

  start(token: string, nowMs: number): void {
    this.token = token;
    this.lastActiveMs = nowMs;
    this.packets = 0;
    this.pastDue = 0;
    this.pastDueMaxMs = 0;
    this.ownOver2Ms = 0;
    this.ownOver5Ms = 0;
    this.ownMaxMs = 0;
    this.failedSends = 0;
    this.dropped = 0;
    this.lastSendMs = null;
    this.spare.reset();
    this.late.reset();
    this.gaps.reset();
    this.resetRow();
  }

  resetRow(): void {
    this.rowPackets = 0;
    this.rowPastDue = 0;
    this.rowLateMaxMs = 0;
    this.rowOwnMaxMs = 0;
    this.rowGaps.reset();
  }

  timing(): CartridgeTiming {
    return {
      token: this.token,
      packets: this.packets,
      arrival: {
        pastDue: this.pastDue,
        pastDueMaxMs: round(this.pastDueMaxMs, 2),
        spareMinMs: this.spare.count === 0 ? 0 : round(this.spare.min, 2),
        spareP1Ms: round(this.spare.percentile(0.01), 2),
        spareP50Ms: round(this.spare.percentile(0.5), 2),
      },
      send: {
        ...summary(this.late),
        ownOver2Ms: this.ownOver2Ms,
        ownOver5Ms: this.ownOver5Ms,
        ownMaxMs: round(this.ownMaxMs, 2),
      },
      gaps: gapStats(this.gaps),
      failedSends: this.failedSends,
      dropped: this.dropped,
    };
  }
}

function summary(histogram: Histogram): LatenessSummary {
  return {
    count: histogram.count,
    p50: round(histogram.percentile(0.5), 2),
    p99: round(histogram.percentile(0.99), 2),
    max: round(histogram.max, 2),
  };
}

/**
 * What the sender saw of its own timing, in memory that does not grow with the length of a run:
 * fixed histograms per cartridge (at most 8), a ring of 10-second rows (3 hours), and a ring of
 * visibility changes. Rows roll on whatever is recorded next, never on a timer, since timers are
 * what is under test. `report` works from the histograms and rows alone, so reading never stalls
 * a send.
 */
export class TimingRecord {
  private startMs: number;
  private readonly cartridges: CartridgeRecord[] = [];
  private readonly unused: CartridgeRecord[] = [];
  private readonly wakes = new Histogram();

  private marginNowMs: number;
  private marginMaxMs: number;

  private rowStartMs: number;
  private rowActive = false;
  private rowMarginMaxMs: number;
  private rowWakeMaxMs = 0;
  private readonly rows = new Array<TimelineRow | undefined>(TIMELINE_ROWS);
  private nextRow = 0;
  private rowCount = 0;

  private visibility: Visibility;
  private readonly visibleAtMs = new Float64Array(VISIBILITY_ENTRIES);
  private readonly visibleStates = new Uint8Array(VISIBILITY_ENTRIES);
  private nextVisibility = 0;
  private visibilityCount = 0;

  private lastPingMs: number | null = null;
  private quietMaxMs = 0;

  constructor(nowMs: number, visibility: Visibility, marginMs: number) {
    this.startMs = nowMs;
    this.rowStartMs = nowMs;
    this.visibility = visibility;
    this.marginNowMs = marginMs;
    this.marginMaxMs = marginMs;
    this.rowMarginMaxMs = marginMs;
    this.logVisibility(nowMs);
  }

  /** A packet left. `sendMs` is when its send began; lateness is measured against the packet's due time. */
  sent(token: string, held: HeldPacket, sendMs: number): void {
    const cartridge = this.touch(token, sendMs);
    cartridge.packets++;
    cartridge.rowPackets++;
    if (!held.stamped) {
      return;
    }

    const lateMs = Math.max(0, sendMs - held.atMs);
    cartridge.late.add(lateMs);
    cartridge.rowLateMaxMs = Math.max(cartridge.rowLateMaxMs, lateMs);
    if (held.leadMs < 0) {
      cartridge.pastDue++;
      cartridge.rowPastDue++;
      cartridge.pastDueMaxMs = Math.max(cartridge.pastDueMaxMs, -held.leadMs);
    } else {
      cartridge.spare.add(held.leadMs);
      cartridge.ownMaxMs = Math.max(cartridge.ownMaxMs, lateMs);
      cartridge.rowOwnMaxMs = Math.max(cartridge.rowOwnMaxMs, lateMs);
      if (lateMs > 2) {
        cartridge.ownOver2Ms++;
      }
      if (lateMs > 5) {
        cartridge.ownOver5Ms++;
      }
    }
    if (cartridge.lastSendMs !== null) {
      const gapMs = sendMs - cartridge.lastSendMs;
      cartridge.gaps.add(gapMs);
      cartridge.rowGaps.add(gapMs);
    }
    cartridge.lastSendMs = sendMs;
  }

  failedSend(token: string, nowMs: number): void {
    this.touch(token, nowMs).failedSends++;
  }

  /** An invalid packet, or one for a cartridge the sender does not list. */
  dropped(token: string, nowMs: number): void {
    this.touch(token, nowMs).dropped++;
  }

  /** A wake-up's lateness. A probe from the steady check is a wake-up too, but only alarms enter the summary. */
  wake(latenessMs: number, nowMs: number, probe: boolean): void {
    this.roll(nowMs);
    this.rowWakeMaxMs = Math.max(this.rowWakeMaxMs, latenessMs);
    if (!probe) {
      this.wakes.add(latenessMs);
    }
  }

  margin(marginMs: number): void {
    this.marginNowMs = marginMs;
    this.marginMaxMs = Math.max(this.marginMaxMs, marginMs);
    this.rowMarginMaxMs = Math.max(this.rowMarginMaxMs, marginMs);
  }

  visibilityChanged(state: Visibility, nowMs: number): void {
    this.roll(nowMs);
    this.visibility = state;
    this.logVisibility(nowMs);
  }

  /** A ping from the app; the longest gap between them is kept and never acted on. */
  ping(nowMs: number): void {
    this.roll(nowMs);
    if (this.lastPingMs !== null) {
      this.quietMaxMs = Math.max(this.quietMaxMs, nowMs - this.lastPingMs);
    }
    this.lastPingMs = nowMs;
  }

  report(nowMs: number): SenderTimingReport {
    const timeline = this.closedRows();
    if (this.rowActive) {
      timeline.push(this.openRow());
    }
    if (timeline.length > TIMELINE_ROWS) {
      timeline.shift();
    }
    return {
      sinceS: round((nowMs - this.startMs) / 1000, 1),
      marginMs: { now: round(this.marginNowMs, 2), max: round(this.marginMaxMs, 2) },
      wake: summary(this.wakes),
      cartridges: this.cartridges.map((cartridge) => cartridge.timing()),
      timeline,
      visibility: this.visibilityLog(),
      appQuietMaxMs: round(this.quietMaxMs, 1),
    };
  }

  /** Forgets everything and restarts the clock at 0. */
  clear(nowMs: number): void {
    this.unused.push(...this.cartridges.splice(0));
    this.wakes.reset();
    this.startMs = nowMs;
    this.marginMaxMs = this.marginNowMs;
    this.rowStartMs = nowMs;
    this.rowActive = false;
    this.rowMarginMaxMs = this.marginNowMs;
    this.rowWakeMaxMs = 0;
    this.rows.fill(undefined);
    this.nextRow = 0;
    this.rowCount = 0;
    this.nextVisibility = 0;
    this.visibilityCount = 0;
    this.logVisibility(nowMs);
    this.lastPingMs = null;
    this.quietMaxMs = 0;
  }

  private touch(token: string, nowMs: number): CartridgeRecord {
    this.roll(nowMs);
    let cartridge = this.cartridges.find((candidate) => candidate.token === token);
    if (!cartridge) {
      cartridge = this.acquire();
      cartridge.start(token, nowMs);
    }
    cartridge.lastActiveMs = nowMs;
    return cartridge;
  }

  /** A fresh record, or at the cap the one silent longest. */
  private acquire(): CartridgeRecord {
    const reusable = this.unused.pop();
    if (reusable) {
      this.cartridges.push(reusable);
      return reusable;
    }
    if (this.cartridges.length < MAX_CARTRIDGES) {
      const created = new CartridgeRecord();
      this.cartridges.push(created);
      return created;
    }
    return this.cartridges.reduce((silent, candidate) =>
      candidate.lastActiveMs < silent.lastActiveMs ? candidate : silent
    );
  }

  /** Called by everything that records: closes the open row if its 10 s are up, then marks the open row used. */
  private roll(nowMs: number): void {
    const wasActive = this.rowActive;
    this.rowActive = true;
    if (nowMs - this.rowStartMs < ROW_MS) {
      return;
    }
    if (wasActive) {
      this.rows[this.nextRow] = this.openRow();
      this.nextRow = (this.nextRow + 1) % TIMELINE_ROWS;
      this.rowCount = Math.min(this.rowCount + 1, TIMELINE_ROWS);
    }
    for (const cartridge of this.cartridges) {
      cartridge.resetRow();
    }
    this.rowStartMs = nowMs;
    this.rowMarginMaxMs = this.marginNowMs;
    this.rowWakeMaxMs = 0;
  }

  private openRow(): TimelineRow {
    return {
      atS: round((this.rowStartMs - this.startMs) / 1000, 1),
      visibility: this.visibility,
      marginMaxMs: round(this.rowMarginMaxMs, 2),
      wakeMaxMs: round(this.rowWakeMaxMs, 2),
      cartridges: this.cartridges
        .filter((cartridge) => cartridge.rowPackets > 0)
        .map((cartridge) => ({
          token: cartridge.token,
          packets: cartridge.rowPackets,
          pastDue: cartridge.rowPastDue,
          lateMaxMs: round(cartridge.rowLateMaxMs, 2),
          ownMaxMs: round(cartridge.rowOwnMaxMs, 2),
          within1MsPct: gapStats(cartridge.rowGaps).within1MsPct,
        })),
    };
  }

  private closedRows(): TimelineRow[] {
    const rows: TimelineRow[] = [];
    const oldest = this.rowCount < TIMELINE_ROWS ? 0 : this.nextRow;
    for (let i = 0; i < this.rowCount; i++) {
      const row = this.rows[(oldest + i) % TIMELINE_ROWS];
      if (row) {
        rows.push(row);
      }
    }
    return rows;
  }

  private logVisibility(nowMs: number): void {
    this.visibleAtMs[this.nextVisibility] = nowMs - this.startMs;
    this.visibleStates[this.nextVisibility] = this.visibility === 'hidden' ? 1 : 0;
    this.nextVisibility = (this.nextVisibility + 1) % VISIBILITY_ENTRIES;
    this.visibilityCount = Math.min(this.visibilityCount + 1, VISIBILITY_ENTRIES);
  }

  private visibilityLog(): { atS: number; state: Visibility }[] {
    const entries: { atS: number; state: Visibility }[] = [];
    const oldest = this.visibilityCount < VISIBILITY_ENTRIES ? 0 : this.nextVisibility;
    for (let i = 0; i < this.visibilityCount; i++) {
      const slot = (oldest + i) % VISIBILITY_ENTRIES;
      entries.push({
        atS: round(this.visibleAtMs[slot] / 1000, 1),
        state: this.visibleStates[slot] === 1 ? 'hidden' : 'visible',
      });
    }
    return entries;
  }
}
