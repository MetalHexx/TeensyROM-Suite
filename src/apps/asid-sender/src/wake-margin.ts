export const MARGIN_FLOOR_MS = 3;
export const MARGIN_CEILING_MS = 20;
export const MARGIN_WINDOW_MS = 2000;
export const MARGIN_RECOMPUTE_EVERY_MS = 100;
export const MARGIN_MIN_SAMPLES = 20;
export const MARGIN_MAX_SAMPLES = 512;

const PERCENTILE = 0.98;

/**
 * How early to wake ahead of a due time: the 98th percentile of the last 2 s of wake-up
 * lateness plus 1 ms, kept between 3 and 20 ms. Worked out again at most every 100 ms, and only
 * with at least 20 samples in the window. Memory is fixed: the last 512 samples in a ring.
 */
export class WakeMargin {
  private readonly atMs = new Float64Array(MARGIN_MAX_SAMPLES);
  private readonly latenessMs = new Float64Array(MARGIN_MAX_SAMPLES);
  private readonly scratch = new Float64Array(MARGIN_MAX_SAMPLES);
  private next = 0;
  private count = 0;
  private lastRecomputeMs = -Infinity;
  private current = MARGIN_FLOOR_MS;

  get marginMs(): number {
    return this.current;
  }

  sample(latenessMs: number, nowMs: number): void {
    this.atMs[this.next] = nowMs;
    this.latenessMs[this.next] = latenessMs;
    this.next = (this.next + 1) % MARGIN_MAX_SAMPLES;
    this.count = Math.min(this.count + 1, MARGIN_MAX_SAMPLES);

    if (nowMs - this.lastRecomputeMs >= MARGIN_RECOMPUTE_EVERY_MS && this.recompute(nowMs)) {
      this.lastRecomputeMs = nowMs;
    }
  }

  /** Returns false, leaving the margin as it was, when the window holds too few samples. */
  private recompute(nowMs: number): boolean {
    const oldestMs = nowMs - MARGIN_WINDOW_MS;
    let inWindow = 0;
    for (let age = 0; age < this.count; age++) {
      const slot = (this.next - 1 - age + MARGIN_MAX_SAMPLES) % MARGIN_MAX_SAMPLES;
      if (this.atMs[slot] < oldestMs) {
        break;
      }
      this.scratch[inWindow++] = this.latenessMs[slot];
    }
    if (inWindow < MARGIN_MIN_SAMPLES) {
      return false;
    }
    const sorted = this.scratch.subarray(0, inWindow).sort();
    const high = sorted[Math.min(inWindow - 1, Math.floor(PERCENTILE * inWindow))];
    this.current = Math.min(MARGIN_CEILING_MS, Math.max(MARGIN_FLOOR_MS, high + 1));
    return true;
  }
}

export type Wait =
  | { readonly kind: 'idle' }
  | { readonly kind: 'spin' }
  | { readonly kind: 'sleep'; readonly delayMs: number };

/**
 * What to do until the head of the queue is due: nothing when nothing is held, take turns
 * back to back when it is due within the margin, otherwise sleep until the margin before it.
 */
export function nextWait(headAtMs: number | null, nowMs: number, marginMs: number): Wait {
  if (headAtMs === null) {
    return { kind: 'idle' };
  }
  const untilDueMs = headAtMs - nowMs;
  if (untilDueMs <= marginMs) {
    return { kind: 'spin' };
  }
  return { kind: 'sleep', delayMs: untilDueMs - marginMs };
}
