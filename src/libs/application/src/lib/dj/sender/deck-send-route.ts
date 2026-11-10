import { Injectable, inject, signal, type Signal } from '@angular/core';
import { milliseconds } from '@sidablist/core';
import type { Milliseconds } from '@sidablist/core';
import { ASID_SENDER_LINK } from '../ports';
import type { TickSource } from '../ports';

/** Where the decks' packets go: `'mixer'` is today's sending, from the mixer page's own MIDI
 *  access; `'sender'` is the timing helper's hidden frame. */
export type SendPath = 'mixer' | 'sender';

/** The tick source a deck's clock runs from on this path: the sender's wake on the sender path, the
 *  audio graph otherwise. */
export function tickSourceOf(path: SendPath): TickSource {
  return path === 'sender' ? 'sender' : 'audio';
}

/**
 * How far past its due time each frame is stamped for the MIDI stack: not at all, so Chrome sends
 * each frame the moment the clock hands it over, and nothing a deck does is delayed. The clock
 * releases frames in bursts — the audio device runs in ~10.7 ms periods — so at zero a frame pair
 * now and then lands on the same instant, where stamping ahead would put every frame on the grid.
 *
 * Bench and ear on InSID3 Out at 1×, real hardware, once the page stopped blocking the main thread:
 * collapsed pairs 3.8% at 0 against 0% at 12 and 20 ms (17% at 0 before), yet the three sounded
 * about the same by ear and 0 the best. The ASID sink caps it at 40 ms for a port that cannot
 * cancel; `djBench.lookahead(ms)` tries another value in a dev build.
 */
export const MIXER_SCHEDULE_AHEAD_MS: Milliseconds = milliseconds(0);

/**
 * How far past its due time each frame is stamped when the timing helper sends. Ear-validated: on
 * 2026-11-07 two decks (Aces High at 1×, InSID3 Out at 2×) ran from a hidden-frame sender with the
 * mixer showing:
 *
 * | Lookahead | Gaps within 1 ms of the median, A / B | Past their stamp | By ear                                |
 * |-----------|---------------------------------------|------------------|---------------------------------------|
 * | 20 ms     | 99.4 / 99.4%                          | 0.1%             | "sounds the same"                     |
 * | 15 ms     | 97.6 / 97.7%                          | 1.6%             | "Everything sounds the same at 15"    |
 * | 10 ms     | 90.6 / 89.2%                          | 9.6%             | "10 has a few extra drops"            |
 *
 * 15 ms is the lowest that held. About 99% of frames leave the mixer within about 15 ms. A
 * 12-minute adaptive-margin run at 15 read 98.0 / 96.5%. The sink caps it at 40 ms for a port that
 * cannot cancel.
 */
export const SENDER_SCHEDULE_AHEAD_MS: Milliseconds = milliseconds(15);

/**
 * Which way the decks' packets go right now and at what lookahead, plus the cartridges the timing
 * helper currently lists. The supervisor decides the path; `DeckRuntime`'s port façade reads it on
 * every send. With no `ASID_SENDER_LINK` provided the path never leaves `'mixer'`, so a deck sends
 * exactly as it did before the helper existed.
 */
@Injectable({ providedIn: 'root' })
export class DeckSendRoute {
  private readonly link = inject(ASID_SENDER_LINK, { optional: true });
  private readonly currentPath = signal<SendPath>('mixer');
  private readonly lookaheads: Record<SendPath, Milliseconds> = {
    mixer: MIXER_SCHEDULE_AHEAD_MS,
    sender: SENDER_SCHEDULE_AHEAD_MS,
  };
  private senderTokens: ReadonlySet<string> = new Set();

  readonly path: Signal<SendPath> = this.currentPath.asReadonly();

  lookaheadFor(path: SendPath): Milliseconds {
    return this.lookaheads[path];
  }

  /** Replaces one path's lookahead until the page reloads; the decks take it up the next time they
   *  are routed onto that path. The dev bench's `lookahead` sets the live path's value here. */
  setLookahead(path: SendPath, ms: Milliseconds): void {
    this.lookaheads[path] = ms;
  }

  /** Switches the path. Does nothing with no link provided: there is no other path to take. */
  setPath(path: SendPath): void {
    if (this.link !== null) {
      this.currentPath.set(path);
    }
  }

  /** Replaces the cartridges the sender lists and returns the set it replaced. */
  setSenderTokens(tokens: readonly string[]): ReadonlySet<string> {
    const previous = this.senderTokens;
    this.senderTokens = new Set(tokens);
    return previous;
  }

  isListedBySender(token: string): boolean {
    return this.senderTokens.has(token);
  }

  /** Hands a packet to the link; a no-op with no link provided. */
  sendToSender(token: string, bytes: Uint8Array, dueAtMs?: number): void {
    this.link?.send(token, bytes, dueAtMs);
  }
}
