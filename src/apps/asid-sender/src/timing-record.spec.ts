import { isSenderToApp } from '@teensyrom-nx/asid-sender-protocol';
import type { HeldPacket } from './release-queue';
import {
  Histogram,
  MAX_CARTRIDGES,
  ROW_MS,
  TIMELINE_ROWS,
  TimingRecord,
  VISIBILITY_ENTRIES,
} from './timing-record';

const BYTES = new Uint8Array([0xf0, 1, 0xf7]);

/** A packet that was due `lateMs` before it left at `sendMs`, and reached the sender `leadMs` ahead of its due time. */
function packet(
  token: string,
  sendMs: number,
  lateMs: number,
  leadMs = 30,
  stamped = true
): HeldPacket {
  return { token, bytes: BYTES, atMs: sendMs - lateMs, stamped, leadMs };
}

/** A deterministic spread: the same numbers every run. */
function spread(count: number, seed: number, scale: number): number[] {
  let state = seed;
  return Array.from({ length: count }, () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return (state / 2147483648) * scale;
  });
}

/** The value at rank floor(p × n) of the sorted list: what the histogram approximates. */
function exactPercentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

const BIN = 0.1;

describe('Histogram', () => {
  it('never grows, however many values it takes', () => {
    const histogram = new Histogram();
    const length = histogram.bins.length;
    const bins = histogram.bins;
    for (const value of spread(50_000, 7, 300)) {
      histogram.add(value);
    }
    expect(histogram.bins).toBe(bins);
    expect(histogram.bins.length).toBe(length);
    expect(histogram.count).toBe(50_000);
  });

  it('agrees with a sorted list to bin resolution', () => {
    const values = spread(2000, 11, 40);
    const histogram = new Histogram();
    values.forEach((value) => histogram.add(value));
    for (const p of [0.01, 0.25, 0.5, 0.9, 0.99]) {
      expect(Math.abs(histogram.percentile(p) - exactPercentile(values, p))).toBeLessThanOrEqual(
        BIN / 2 + 1e-9
      );
    }
    expect(histogram.max).toBe(Math.max(...values));
    expect(histogram.min).toBe(Math.min(...values));
  });

  it('keeps the exact maximum for values past its range', () => {
    const histogram = new Histogram();
    [1, 2, 250, 3, 4000.5].forEach((value) => histogram.add(value));
    expect(histogram.max).toBe(4000.5);
    expect(histogram.percentile(0.99)).toBe(4000.5);
    expect(histogram.percentile(0.2)).toBeCloseTo(2.05, 6);
  });

  it('is zero when empty', () => {
    expect(new Histogram().percentile(0.5)).toBe(0);
  });
});

describe('TimingRecord', () => {
  describe('per cartridge', () => {
    it('reads send lateness, gaps and arrival the way a brute-force pass over the same frames does', () => {
      const record = new TimingRecord(0, 'visible', 3);
      const lates = spread(600, 3, 6);
      const gapsMs = spread(600, 5, 1).map((x) => 19 + x * 2);
      const leads = spread(600, 9, 60);

      let at = 1000;
      const sentAt: number[] = [];
      lates.forEach((late, i) => {
        at += gapsMs[i];
        sentAt.push(at);
        record.sent('1234', packet('1234', at, late, leads[i]), at);
      });

      const [cartridge] = record.report(at).cartridges;
      expect(cartridge.token).toBe('1234');
      expect(cartridge.packets).toBe(600);

      expect(cartridge.send.count).toBe(600);
      expect(Math.abs(cartridge.send.p50 - exactPercentile(lates, 0.5))).toBeLessThanOrEqual(BIN);
      expect(Math.abs(cartridge.send.p99 - exactPercentile(lates, 0.99))).toBeLessThanOrEqual(BIN);
      expect(cartridge.send.max).toBeCloseTo(Math.max(...lates), 2);
      expect(cartridge.send.ownMaxMs).toBeCloseTo(Math.max(...lates), 2);
      expect(cartridge.send.ownOver2Ms).toBe(lates.filter((x) => x > 2).length);
      expect(cartridge.send.ownOver5Ms).toBe(lates.filter((x) => x > 5).length);

      expect(
        Math.abs(cartridge.arrival.spareP50Ms - exactPercentile(leads, 0.5))
      ).toBeLessThanOrEqual(BIN);
      expect(
        Math.abs(cartridge.arrival.spareP1Ms - exactPercentile(leads, 0.01))
      ).toBeLessThanOrEqual(BIN);
      expect(cartridge.arrival.spareMinMs).toBeCloseTo(Math.min(...leads), 2);
      expect(cartridge.arrival.pastDue).toBe(0);

      const gaps = sentAt.slice(1).map((time, i) => time - sentAt[i]);
      const median = exactPercentile(gaps, 0.5);
      expect(Math.abs(cartridge.gaps.medianMs - median)).toBeLessThanOrEqual(BIN);
      // "Within 1 ms of the median" is counted in whole bins either side of the median's bin, so it
      // may differ from an exact count by the values within a bin of the edge.
      const within = (100 * gaps.filter((g) => Math.abs(g - median) <= 1).length) / gaps.length;
      const slack =
        (100 * gaps.filter((g) => Math.abs(Math.abs(g - median) - 1) <= 2 * BIN).length) /
        gaps.length;
      expect(Math.abs(cartridge.gaps.within1MsPct - within)).toBeLessThanOrEqual(slack + 0.1);
      expect(cartridge.gaps.offOver5Ms).toBe(gaps.filter((g) => Math.abs(g - median) > 5).length);
    });

    it('counts the gaps more than 5 ms off the median', () => {
      const record = new TimingRecord(0, 'visible', 3);
      let at = 1000;
      for (const gap of [20, 20, 20, 20, 20, 20, 20, 31, 20, 8, 20, 20]) {
        at += gap;
        record.sent('1234', packet('1234', at, 0), at);
      }
      const { gaps } = record.report(at).cartridges[0];
      expect(gaps.medianMs).toBeCloseTo(20, 0);
      expect(gaps.offOver5Ms).toBe(2);
    });

    it('splits frames that arrived past due from frames that left late on their own', () => {
      const record = new TimingRecord(0, 'visible', 3);
      record.sent('1234', packet('1234', 1000, 9, -9), 1000); // arrived 9 ms past due
      record.sent('1234', packet('1234', 1020, 3, 25), 1020); // on time, left 3 ms late
      record.sent('1234', packet('1234', 1040, 6.5, 25), 1040); // on time, left 6.5 ms late
      record.sent('1234', packet('1234', 1060, 0.4, 25), 1060);

      const [cartridge] = record.report(1060).cartridges;
      expect(cartridge.arrival).toMatchObject({ pastDue: 1, pastDueMaxMs: 9 });
      expect(cartridge.arrival.spareMinMs).toBeCloseTo(25, 6);
      expect(cartridge.send.max).toBe(9);
      expect(cartridge.send.ownMaxMs).toBe(6.5);
      expect(cartridge.send.ownOver2Ms).toBe(2);
      expect(cartridge.send.ownOver5Ms).toBe(1);
    });

    it('counts packets that were not stamped but keeps them out of the timing', () => {
      const record = new TimingRecord(0, 'visible', 3);
      record.sent('1234', packet('1234', 1000, 0, 0, false), 1000);
      record.sent('1234', packet('1234', 1500, 0, 0, false), 1500);
      const [cartridge] = record.report(1500).cartridges;
      expect(cartridge.packets).toBe(2);
      expect(cartridge.send.count).toBe(0);
      expect(cartridge.gaps.medianMs).toBe(0);
    });

    it('counts failed sends and dropped packets per cartridge', () => {
      const record = new TimingRecord(0, 'visible', 3);
      record.failedSend('1234', 100);
      record.failedSend('1234', 110);
      record.dropped('abcd', 120);
      const report = record.report(130);
      const byToken = Object.fromEntries(report.cartridges.map((c) => [c.token, c]));
      expect(byToken['1234']).toMatchObject({ failedSends: 2, dropped: 0, packets: 0 });
      expect(byToken['abcd']).toMatchObject({ failedSends: 0, dropped: 1 });
    });

    it('keeps two cartridges apart', () => {
      const record = new TimingRecord(0, 'visible', 3);
      record.sent('a', packet('a', 1000, 1), 1000);
      record.sent('b', packet('b', 1001, 4), 1001);
      const [a, b] = record.report(1001).cartridges;
      expect([a.token, a.send.max, b.token, b.send.max]).toEqual(['a', 1, 'b', 4]);
    });
  });

  describe('shared', () => {
    it('keeps wake-up lateness from alarms, and the margin now and at its highest', () => {
      const record = new TimingRecord(0, 'visible', 3);
      record.wake(0.5, 100, false);
      record.wake(2.5, 200, false);
      record.wake(9, 300, true); // a probe: timeline only
      record.margin(7);
      record.margin(4);
      const report = record.report(300);
      expect(report.wake).toMatchObject({ count: 2, max: 2.5 });
      expect(report.marginMs).toEqual({ now: 4, max: 7 });
      expect(report.timeline[0]).toMatchObject({ marginMaxMs: 7, wakeMaxMs: 9 });
    });

    it('keeps the longest gap between pings', () => {
      const record = new TimingRecord(0, 'visible', 3);
      [1000, 1040, 1080, 1400, 1440].forEach((at) => record.ping(at));
      expect(record.report(1500).appQuietMaxMs).toBe(320);
    });

    it('logs visibility changes, starting with the state at the start', () => {
      const record = new TimingRecord(5000, 'visible', 3);
      record.visibilityChanged('hidden', 7500);
      record.visibilityChanged('visible', 9000);
      expect(record.report(9000).visibility).toEqual([
        { atS: 0, state: 'visible' },
        { atS: 2.5, state: 'hidden' },
        { atS: 4, state: 'visible' },
      ]);
    });
  });

  describe('the timeline', () => {
    it('rolls a row when something is recorded 10 s after the row opened, not before', () => {
      const record = new TimingRecord(0, 'visible', 3);
      record.sent('1234', packet('1234', 1000, 1), 1000);
      record.sent('1234', packet('1234', ROW_MS - 1, 1), ROW_MS - 1);
      expect(record.report(ROW_MS - 1).timeline).toHaveLength(1);

      record.sent('1234', packet('1234', ROW_MS + 5, 2), ROW_MS + 5);
      const { timeline } = record.report(ROW_MS + 5);
      expect(timeline).toHaveLength(2);
      expect(timeline[0]).toMatchObject({ atS: 0 });
      expect(timeline[0].cartridges[0]).toMatchObject({ token: '1234', packets: 2, lateMaxMs: 1 });
      expect(timeline[1]).toMatchObject({ atS: 10 });
      expect(timeline[1].cartridges[0]).toMatchObject({ packets: 1, lateMaxMs: 2 });
    });

    it('rolls on a wake-up or a ping as well', () => {
      const record = new TimingRecord(0, 'visible', 3);
      record.wake(1, 100, false);
      record.wake(1, ROW_MS + 100, false);
      record.ping(2 * ROW_MS + 200);
      expect(record.report(2 * ROW_MS + 200).timeline.map((row) => row.atS)).toEqual([
        0, 10.1, 20.2,
      ]);
    });

    it("records a row's visibility, margin and gap steadiness", () => {
      const record = new TimingRecord(0, 'visible', 3);
      record.margin(12);
      let at = 1000;
      for (let i = 0; i < 20; i++) {
        at += 20;
        record.sent('1234', packet('1234', at, 0), at);
      }
      record.visibilityChanged('hidden', 4000);
      record.sent('1234', packet('1234', ROW_MS + 1, 0), ROW_MS + 1);
      const [closed] = record.report(ROW_MS + 1).timeline;
      expect(closed.visibility).toBe('hidden');
      expect(closed.marginMaxMs).toBe(12);
      expect(closed.cartridges[0].within1MsPct).toBe(100);
    });

    it("starts each row's gaps afresh but keeps the last send across the boundary", () => {
      const record = new TimingRecord(0, 'visible', 3);
      record.sent('1234', packet('1234', 9990, 0), 9990);
      record.sent('1234', packet('1234', 10010, 0), 10010);
      record.sent('1234', packet('1234', 10030, 0), 10030);
      const { timeline } = record.report(10030);
      expect(timeline[1].cartridges[0].within1MsPct).toBe(100);
      expect(record.report(10030).cartridges[0].gaps.medianMs).toBeCloseTo(20, 0);
    });

    it('leaves out a closed row nothing was recorded in', () => {
      const record = new TimingRecord(0, 'visible', 3);
      record.sent('1234', packet('1234', 5 * ROW_MS, 0), 5 * ROW_MS);
      expect(record.report(5 * ROW_MS).timeline).toHaveLength(1);
    });
  });

  describe('bounded memory', () => {
    it('holds 1,080 rows, 8 cartridges and 256 visibility entries however long it runs', () => {
      const record = new TimingRecord(0, 'visible', 3);
      const tokens = Array.from({ length: 12 }, (_, i) => `t${i}`);
      let at = 0;
      for (let second = 0; second < 12_000; second++) {
        at = second * 1000;
        const token = tokens[second % tokens.length];
        record.sent(token, packet(token, at, 1), at);
        record.wake(1, at, false);
        if (second % 40 === 0) {
          record.visibilityChanged(second % 80 === 0 ? 'hidden' : 'visible', at);
        }
      }
      const report = record.report(at);
      expect(report.timeline.length).toBeLessThanOrEqual(TIMELINE_ROWS);
      expect(report.timeline.length).toBeGreaterThan(TIMELINE_ROWS - 2);
      expect(report.cartridges.length).toBe(MAX_CARTRIDGES);
      expect(report.visibility.length).toBe(VISIBILITY_ENTRIES);
      expect(report.visibility[report.visibility.length - 1].atS).toBe(11_960);
      expect(report.timeline[report.timeline.length - 1].atS).toBeGreaterThan(11_900);
    });

    it('makes a report of the same size after thousands more packets', () => {
      const record = new TimingRecord(0, 'visible', 3);
      const run = (from: number, count: number) => {
        for (let i = 0; i < count; i++) {
          const at = from + i * 20;
          record.sent('1234', packet('1234', at, (i % 7) * 0.3), at);
        }
        return from + count * 20;
      };
      const mid = run(0, 5_000);
      const small = JSON.stringify(record.report(mid)).length;
      const end = run(mid, 5_000);
      const large = JSON.stringify(record.report(end)).length;
      // Only the rows added (one more 10 s row per 200 packets) grow it, and not the per-frame data.
      expect(large).toBeLessThan(small * 2.2);
      expect(record.report(end).cartridges[0].send.count).toBe(10_000);
    });

    it('replaces the cartridge silent longest when a ninth arrives', () => {
      const record = new TimingRecord(0, 'visible', 3);
      for (let i = 0; i < MAX_CARTRIDGES; i++) {
        record.sent(`c${i}`, packet(`c${i}`, 1000 + i, 0), 1000 + i);
      }
      record.sent('c0', packet('c0', 2000, 0), 2000); // c0 is active again; c1 is now the silent one
      record.sent('new', packet('new', 2010, 2), 2010);

      const tokens = record.report(2010).cartridges.map((c) => c.token);
      expect(tokens).toHaveLength(MAX_CARTRIDGES);
      expect(tokens).toContain('new');
      expect(tokens).toContain('c0');
      expect(tokens).not.toContain('c1');
      const added = record.report(2010).cartridges.find((c) => c.token === 'new');
      expect(added).toMatchObject({ packets: 1 });
      expect(added?.send.count).toBe(1);
    });
  });

  describe('clearing and reading', () => {
    it('clear forgets everything and restarts the clock at 0', () => {
      const record = new TimingRecord(0, 'visible', 3);
      record.sent('1234', packet('1234', 1000, 1), 1000);
      record.sent('1234', packet('1234', 30_000, 1), 30_000);
      record.wake(2, 30_000, false);
      record.ping(30_000);
      record.ping(35_000);
      record.margin(9);
      record.visibilityChanged('hidden', 31_000);

      record.clear(40_000);
      record.sent('abcd', packet('abcd', 42_000, 1), 42_000);
      const report = record.report(45_000);

      expect(report.sinceS).toBe(5);
      expect(report.cartridges.map((c) => c.token)).toEqual(['abcd']);
      expect(report.wake.count).toBe(0);
      expect(report.appQuietMaxMs).toBe(0);
      expect(report.marginMs).toEqual({ now: 9, max: 9 });
      expect(report.timeline).toHaveLength(1);
      expect(report.timeline[0].atS).toBe(0);
      expect(report.visibility).toEqual([{ atS: 0, state: 'hidden' }]);
    });

    it('does not change anything by being read', () => {
      const record = new TimingRecord(0, 'visible', 3);
      record.sent('1234', packet('1234', 1000, 1), 1000);
      const first = record.report(60_000);
      const second = record.report(60_000);
      expect(second).toEqual(first);
      record.sent('1234', packet('1234', 1020, 1), 1020);
      expect(record.report(60_000).cartridges[0].packets).toBe(2);
    });

    it('makes a report the protocol accepts, empty or full, even after a structured clone', () => {
      const record = new TimingRecord(0, 'visible', 3);
      expect(isSenderToApp({ k: 'timing', id: 1, report: record.report(10) })).toBe(true);

      record.sent('1234', packet('1234', 1000, 1, -3), 1000);
      record.sent('abcd', packet('abcd', 1010, 0, 40), 1010);
      record.wake(1, 1010, false);
      const message = { k: 'timing', id: 2, report: record.report(20_000) };
      expect(isSenderToApp(structuredClone(message))).toBe(true);
    });
  });
});
