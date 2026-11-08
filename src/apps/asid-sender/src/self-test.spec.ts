import { SELF_TEST_CAPACITY, SELF_TEST_MAX_MS, SelfTest } from './self-test';

const TIME_ORIGIN = 1_700_000_000_000;

function rig() {
  const clock = { t: 100 };
  const posted = { ticks: 0 };
  const test = new SelfTest({
    now: () => clock.t,
    timeOrigin: TIME_ORIGIN,
    postTick: () => posted.ticks++,
  });
  /** Delivers ticks `everyMs` apart for `forMs`, as a page on its own thread would. */
  const run = (forMs: number, everyMs: number) => {
    const until = clock.t + forMs;
    while (clock.t < until && posted.ticks > 0) {
      posted.ticks--;
      clock.t += everyMs;
      test.onTick();
    }
  };
  return { clock, posted, test, run };
}

describe('SelfTest', () => {
  it('starts a ticker when armed', () => {
    const r = rig();
    r.test.arm();
    expect(r.posted.ticks).toBe(1);
  });

  it('counts the turns it took inside the hold', () => {
    const r = rig();
    r.test.arm();
    r.run(300, 1); // 100..400 on this page's clock; the hold sits in the middle
    const holdStart = TIME_ORIGIN + 200;
    const holdEnd = TIME_ORIGIN + 300;
    const turns = r.test.end(holdStart, holdEnd);
    expect(turns).toBeGreaterThanOrEqual(99);
    expect(turns).toBeLessThanOrEqual(101);
  });

  it('counts none when the page could not take a turn during the hold', () => {
    const r = rig();
    r.test.arm();
    r.run(100, 1); // turns up to 200
    r.clock.t = 400; // the shared thread was held from 200 to 400
    r.run(100, 1);
    expect(r.test.end(TIME_ORIGIN + 210, TIME_ORIGIN + 390)).toBe(0);
  });

  it('stops itself after a second', () => {
    const r = rig();
    r.test.arm();
    r.run(5000, 1);
    expect(r.clock.t - 100).toBeGreaterThanOrEqual(SELF_TEST_MAX_MS);
    expect(r.clock.t - 100).toBeLessThanOrEqual(SELF_TEST_MAX_MS + 1);
    expect(r.posted.ticks).toBe(0);
  });

  it('stops when told to end, and a late tick adds nothing', () => {
    const r = rig();
    r.test.arm();
    r.run(50, 1);
    r.test.end(0, 0);
    r.posted.ticks = 0;
    r.test.onTick();
    expect(r.posted.ticks).toBe(0);
    expect(r.test.end(TIME_ORIGIN, TIME_ORIGIN + 10_000)).toBeLessThanOrEqual(51);
  });

  it('keeps the latest 4,096 turns in memory that does not grow', () => {
    const r = rig();
    r.test.arm();
    r.run(SELF_TEST_MAX_MS, 0.05); // 20,000 turns in a second
    expect(r.test.end(TIME_ORIGIN, TIME_ORIGIN + 10_000)).toBe(SELF_TEST_CAPACITY);
    // The hold at the very end is still in the ring.
    expect(r.test.end(TIME_ORIGIN + 1050, TIME_ORIGIN + 1100)).toBeGreaterThan(0);
  });

  it('starts afresh when armed again', () => {
    const r = rig();
    r.test.arm();
    r.run(100, 1);
    r.test.arm();
    expect(r.test.end(TIME_ORIGIN, TIME_ORIGIN + 10_000)).toBe(0);
  });
});
