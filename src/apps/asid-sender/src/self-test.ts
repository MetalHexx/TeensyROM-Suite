import { toSharedTime } from '@teensyrom-nx/asid-sender-protocol';

export const SELF_TEST_CAPACITY = 4096;
export const SELF_TEST_MAX_MS = 1000;

export interface SelfTestEnv {
  now(): number;
  readonly timeOrigin: number;
  /** Asks for one more turn through the page's own `MessageChannel`; `onTick` is its delivery. */
  postTick(): void;
}

/**
 * Whether this page runs on a thread of its own. Once armed it takes turns back to back over its
 * own `MessageChannel` for up to a second, noting the shared time of each in a ring of the latest
 * 4,096. A sender sharing the app's thread cannot take a turn while the app holds that thread, so
 * it counts none inside the hold. The count is the whole answer; the app judges the pass.
 */
export class SelfTest {
  private readonly turns = new Float64Array(SELF_TEST_CAPACITY);
  private next = 0;
  private count = 0;
  private running = false;
  private startedMs = 0;

  constructor(private readonly env: SelfTestEnv) {}

  arm(): void {
    this.next = 0;
    this.count = 0;
    this.running = true;
    this.startedMs = this.env.now();
    this.env.postTick();
  }

  onTick(): void {
    if (!this.running) {
      return;
    }
    const nowMs = this.env.now();
    this.turns[this.next] = toSharedTime(nowMs, this.env.timeOrigin);
    this.next = (this.next + 1) % SELF_TEST_CAPACITY;
    this.count = Math.min(this.count + 1, SELF_TEST_CAPACITY);
    if (nowMs - this.startedMs >= SELF_TEST_MAX_MS) {
      this.running = false;
    } else {
      this.env.postTick();
    }
  }

  /** Stops the ticker and counts the turns taken within `[holdStart, holdEnd]` (shared clock). */
  end(holdStart: number, holdEnd: number): number {
    this.running = false;
    let inside = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.turns[i] >= holdStart && this.turns[i] <= holdEnd) {
        inside++;
      }
    }
    return inside;
  }
}
