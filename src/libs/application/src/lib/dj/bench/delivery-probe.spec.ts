import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryProbe } from './delivery-probe';

describe('DeliveryProbe', () => {
  let nowMs: number;
  let probe: DeliveryProbe;

  beforeEach(() => {
    nowMs = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    probe = new DeliveryProbe();
    probe.setScheduleAhead(15);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A frame handed over `lagMs` after it fell due: stamped schedule-ahead past its due time. */
  function send(lagMs: number): void {
    probe.record(nowMs - lagMs + 15);
  }

  it('reads percentiles and the exact maximum over more than the old 8,192-send ring', () => {
    for (let i = 0; i < 20_000; i++) {
      nowMs += 10;
      send(i % 100 === 0 ? 40 : 3);
    }

    const summary = probe.summarize(10);

    expect(summary.frames).toBe(20_000);
    expect(summary.lagMs.p50).toBeCloseTo(3, 1);
    expect(summary.lagMs.p99).toBeCloseTo(40, 1);
    expect(summary.lagMs.max).toBe(40);
    expect(summary.lagPct['≤5']).toBe(99);
    expect(summary.lagPct['>30']).toBe(1);
  });

  it('counts the share handed over at or past its stamp as missing the window', () => {
    for (let i = 0; i < 10; i++) {
      nowMs += 10;
      send(i < 3 ? 20 : 4);
    }

    expect(probe.summarize(10).missedWindowPct).toBe(30);
  });

  it("closes a timeline row every 10 s with that row's own p99 and max", () => {
    send(2);
    nowMs += 5_000;
    send(2);
    nowMs += 5_000;
    send(30);
    nowMs += 10_000;
    send(4);

    const [first, second, ...rest] = probe.lagTimeline();

    expect(rest).toEqual([]);
    expect(first).toMatchObject({ atS: 10, frames: 2, maxMs: 2 });
    expect(first.p99Ms).toBeCloseTo(2, 1);
    expect(second).toMatchObject({ atS: 20, frames: 1, maxMs: 30 });
    expect(second.p99Ms).toBeCloseTo(30, 0);
  });

  it('closes the quiet rows of a pause as empty ones', () => {
    send(2);
    nowMs += 35_000;
    send(2);

    expect(probe.lagTimeline().map((row) => row.frames)).toEqual([1, 0, 0]);
  });

  it('keeps at most 1,080 rows', () => {
    for (let row = 0; row < 1_200; row++) {
      send(2);
      nowMs += 10_000;
    }
    send(2);

    const rows = probe.lagTimeline();

    expect(rows).toHaveLength(1_080);
    expect(rows[1_079].atS).toBe(10_800);
  });

  it('keeps its readings when only the schedule-ahead changes', () => {
    send(2);

    probe.setScheduleAhead(7);

    expect(probe.summarize(10).frames).toBe(1);
  });

  it('starts over on reset, timeline included', () => {
    send(2);
    nowMs += 25_000;
    send(2);

    probe.reset();

    expect(probe.summarize(10).frames).toBe(0);
    expect(probe.lagTimeline()).toEqual([]);
    nowMs += 3_000;
    send(2);
    nowMs += 10_000;
    send(2);
    expect(probe.lagTimeline()).toEqual([expect.objectContaining({ atS: 10, frames: 1 })]);
  });
});
