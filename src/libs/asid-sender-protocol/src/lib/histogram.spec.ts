import { Histogram, summarizeLateness } from './histogram';

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

describe('summarizeLateness', () => {
  it('reads the count, median, 99th percentile and maximum, rounded to 0.01 ms', () => {
    const histogram = new Histogram();
    [1, 2, 3, 4.123].forEach((value) => histogram.add(value));

    expect(summarizeLateness(histogram)).toEqual({ count: 4, p50: 3.05, p99: 4.15, max: 4.12 });
  });

  it('is all zero when empty', () => {
    expect(summarizeLateness(new Histogram())).toEqual({ count: 0, p50: 0, p99: 0, max: 0 });
  });
});
