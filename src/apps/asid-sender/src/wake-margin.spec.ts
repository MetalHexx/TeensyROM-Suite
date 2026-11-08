import {
  MARGIN_CEILING_MS,
  MARGIN_FLOOR_MS,
  MARGIN_MAX_SAMPLES,
  WakeMargin,
  nextWait,
} from './wake-margin';

/** Feeds `count` samples of the same lateness, 10 ms apart, from `startMs`; returns the last time. */
function feed(margin: WakeMargin, lateness: number, count: number, startMs = 0): number {
  let at = startMs;
  for (let i = 0; i < count; i++) {
    margin.sample(lateness, at);
    at += 10;
  }
  return at - 10;
}

describe('nextWait', () => {
  it('is idle when nothing is held', () => {
    expect(nextWait(null, 100, 5)).toEqual({ kind: 'idle' });
  });

  it('spins when the head is due within the margin, or already due', () => {
    expect(nextWait(105, 100, 5)).toEqual({ kind: 'spin' });
    expect(nextWait(103, 100, 5)).toEqual({ kind: 'spin' });
    expect(nextWait(100, 100, 5)).toEqual({ kind: 'spin' });
    expect(nextWait(90, 100, 5)).toEqual({ kind: 'spin' });
  });

  it('otherwise sleeps until the margin before the head is due', () => {
    expect(nextWait(120, 100, 5)).toEqual({ kind: 'sleep', delayMs: 15 });
    expect(nextWait(105.5, 100, 5)).toEqual({ kind: 'sleep', delayMs: 0.5 });
  });
});

describe('WakeMargin', () => {
  it('starts at the floor', () => {
    expect(new WakeMargin().marginMs).toBe(MARGIN_FLOOR_MS);
  });

  it('is the 98th percentile of the window plus 1 ms', () => {
    const margin = new WakeMargin();
    // 100 samples at 0.0, 0.1 ... 9.9 ms: the 98th percentile is 9.8.
    for (let i = 0; i < 100; i++) {
      margin.sample(i / 10, i * 10);
    }
    expect(margin.marginMs).toBeCloseTo(10.8, 6);
  });

  it('is clamped to the floor', () => {
    const margin = new WakeMargin();
    feed(margin, 0.2, 30);
    expect(margin.marginMs).toBe(MARGIN_FLOOR_MS);
  });

  it('is clamped to the ceiling', () => {
    const margin = new WakeMargin();
    feed(margin, 45, 30);
    expect(margin.marginMs).toBe(MARGIN_CEILING_MS);
  });

  it('needs 20 samples in the window before it moves', () => {
    const margin = new WakeMargin();
    feed(margin, 9, 19);
    expect(margin.marginMs).toBe(MARGIN_FLOOR_MS);
    margin.sample(9, 200);
    expect(margin.marginMs).toBe(10);
  });

  it('works the margin out again at most every 100 ms', () => {
    const margin = new WakeMargin();
    const last = feed(margin, 6, 20, 0); // the 20th sample, at 190 ms, sets the margin to 7
    expect(margin.marginMs).toBe(7);

    for (let i = 1; i <= 9; i++) {
      margin.sample(15, last + i * 10); // 10..90 ms later: no recompute
    }
    expect(margin.marginMs).toBe(7);

    margin.sample(15, last + 100);
    expect(margin.marginMs).toBeGreaterThan(7);
  });

  it('lets samples age out of the 2 s window', () => {
    const margin = new WakeMargin();
    const last = feed(margin, 12, 30); // margin 13
    expect(margin.marginMs).toBe(13);

    // 2.5 s later the old samples are out of the window; fresh calm ones take over.
    feed(margin, 0.5, 25, last + 2500);
    expect(margin.marginMs).toBe(MARGIN_FLOOR_MS);
  });

  it('does not recompute from fewer than 20 samples once the old ones have aged out', () => {
    const margin = new WakeMargin();
    const last = feed(margin, 12, 30);
    margin.sample(0, last + 2500);
    expect(margin.marginMs).toBe(13);
  });

  it('works the percentile over only the last 512 samples', () => {
    const margin = new WakeMargin();
    // All inside one 2 s window: 100 big samples, then 512 small ones. Were they all counted, one in
    // six would be big and the margin 16; the ring has dropped the big ones.
    for (let i = 0; i < 100; i++) {
      margin.sample(15, i);
    }
    for (let i = 100; i < 100 + MARGIN_MAX_SAMPLES; i++) {
      margin.sample(0.5, i);
    }
    margin.sample(0.5, 900);
    expect(margin.marginMs).toBe(MARGIN_FLOOR_MS);
  });
});
