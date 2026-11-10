import { MAX_WAKE_ALARMS } from '@teensyrom-nx/asid-sender-protocol';

/** The armed wake alarms, by id, at most `MAX_WAKE_ALARMS`. Times are on this page's clock. */
export class WakeAlarms {
  private readonly ids: number[] = [];
  private readonly atMs: number[] = [];
  private readonly due = { id: 0, atMs: 0 };

  /** Arms or re-arms `id` for `atMs` (this page's clock). False, changing nothing, for a new id at capacity. */
  set(id: number, atMs: number): boolean {
    const index = this.ids.indexOf(id);
    if (index >= 0) {
      this.atMs[index] = atMs;
      return true;
    }
    if (this.ids.length >= MAX_WAKE_ALARMS) {
      return false;
    }
    this.ids.push(id);
    this.atMs.push(atMs);
    return true;
  }

  delete(id: number): void {
    const index = this.ids.indexOf(id);
    if (index >= 0) {
      this.remove(index);
    }
  }

  /** The earliest armed time, or null. */
  nextAtMs(): number | null {
    const index = this.earliest();
    return index < 0 ? null : this.atMs[index];
  }

  /**
   * Removes and returns the earliest alarm whose time has come, or null; never one still in the
   * future. The returned object is reused by the next call.
   */
  takeDue(nowMs: number): { id: number; atMs: number } | null {
    const index = this.earliest();
    if (index < 0 || this.atMs[index] > nowMs) {
      return null;
    }
    this.due.id = this.ids[index];
    this.due.atMs = this.atMs[index];
    this.remove(index);
    return this.due;
  }

  /** The index of the earliest alarm, the first armed of equal times; -1 when none. */
  private earliest(): number {
    let best = -1;
    for (let i = 0; i < this.ids.length; i++) {
      if (best < 0 || this.atMs[i] < this.atMs[best]) {
        best = i;
      }
    }
    return best;
  }

  private remove(index: number): void {
    const last = this.ids.length - 1;
    for (let i = index; i < last; i++) {
      this.ids[i] = this.ids[i + 1];
      this.atMs[i] = this.atMs[i + 1];
    }
    this.ids.length = last;
    this.atMs.length = last;
  }
}
