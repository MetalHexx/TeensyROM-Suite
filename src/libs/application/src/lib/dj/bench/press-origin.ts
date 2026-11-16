import { Injectable } from '@angular/core';

/**
 * Bench instrumentation, used in dev builds only: when the controller message being handled right now
 * arrived, so a press it causes is timed from the controller rather than from the moment it reached
 * the deck. Without it, the press probe's clock starts after any wait while the page was busy.
 *
 * The mapping engine brackets each message's synchronous dispatch with `begin` and `end`. A press
 * marked inside that bracket starts at the message's arrival. Any other press, such as one from the
 * screen, starts when it is marked, as before. Nothing here allocates.
 */
@Injectable({ providedIn: 'root' })
export class PressOrigin {
  private arrivedAtMs: number | null = null;

  /** A controller message that arrived at `arrivedAtMs` is being handled. */
  begin(arrivedAtMs: number): void {
    this.arrivedAtMs = arrivedAtMs;
  }

  /** The message's handling is over. */
  end(): void {
    this.arrivedAtMs = null;
  }

  /** Whether a press marked now came from a controller message with a usable arrival time. */
  fromController(nowMs: number): boolean {
    const arrived = this.arrivedAtMs;
    // An arrival of 0 or one in the future is a port that does not stamp its messages; the
    // press then starts when it is marked, as one from the screen does.
    return arrived !== null && arrived > 0 && arrived <= nowMs;
  }

  /** When a press marked at `nowMs` started: the arrival of the controller message being handled,
   *  or `nowMs` itself. */
  startMs(nowMs: number): number {
    return this.fromController(nowMs) ? (this.arrivedAtMs as number) : nowMs;
  }
}
