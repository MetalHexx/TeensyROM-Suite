export interface HeldPacket {
  readonly token: string;
  readonly bytes: Uint8Array;
  /** When it leaves, on this page's clock. May lie in the past for a packet that arrived past due. */
  readonly atMs: number;
  readonly stamped: boolean;
  /** How far ahead of its due time it arrived; negative = it arrived past due. */
  readonly leadMs: number;
}

/**
 * Packets held until their release time, earliest first. A cartridge's packets never leave out of
 * the order they arrived, and equal times keep arrival order across cartridges too.
 */
export class ReleaseQueue {
  private readonly held: HeldPacket[] = [];
  private readonly lastAtByToken = new Map<string, number>();

  get size(): number {
    return this.held.length;
  }

  /** `dueMs` is on this page's clock (already converted from the shared clock), or null for "now". */
  enqueue(token: string, bytes: Uint8Array, dueMs: number | null, nowMs: number): void {
    const wanted = dueMs ?? nowMs;
    const atMs = Math.max(wanted, this.lastAtByToken.get(token) ?? -Infinity);
    this.lastAtByToken.set(token, atMs);

    const packet: HeldPacket = {
      token,
      bytes,
      atMs,
      stamped: dueMs !== null,
      leadMs: wanted - nowMs,
    };
    let index = this.held.length;
    while (index > 0 && this.held[index - 1].atMs > atMs) {
      index--;
    }
    this.held.splice(index, 0, packet);
  }

  /** The head's release time, or null when nothing is held. */
  nextAtMs(): number | null {
    return this.held.length > 0 ? this.held[0].atMs : null;
  }

  /** Removes and returns the head when its release time has come. */
  takeDue(nowMs: number): HeldPacket | null {
    if (this.held.length === 0 || this.held[0].atMs > nowMs) {
      return null;
    }
    return this.held.shift() ?? null;
  }
}
