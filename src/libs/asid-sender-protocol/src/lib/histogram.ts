import type { LatenessSummary } from './timing-report';

export const BINS_PER_MS = 10;
const RANGE_MS = 100;
const BIN_COUNT = RANGE_MS * BINS_PER_MS;

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

/** The count, median, 99th percentile and largest value of a lateness histogram, each rounded to 0.01 ms. */
export function summarizeLateness(histogram: Histogram): LatenessSummary {
  const round = (value: number): number => Math.round(value * 100) / 100;
  return {
    count: histogram.count,
    p50: round(histogram.percentile(0.5)),
    p99: round(histogram.percentile(0.99)),
    max: round(histogram.max),
  };
}
