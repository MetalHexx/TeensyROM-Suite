import { InjectionToken } from '@angular/core';
import type { FrameClock, ReplayRunner } from '@sidablist/core';
import type { LatenessSummary } from '@teensyrom-nx/asid-sender-protocol';

/** What drives a deck's frames: the silent audio graph on the mixer page, or the sender's wake. */
export type TickSource = 'audio' | 'sender';

/** What a clock on the sender source has measured since the last reset. */
export interface WakeReadings {
  readonly wakes: number;
  /** Wakes that found no frame due and asked again. */
  readonly early: number;
  /** Silent beats the backstop re-armed on. */
  readonly guardRearms: number;
  /** Asked → sent by the sender. */
  readonly senderLateMs: LatenessSummary;
  /** Sent → handled on the mixer. */
  readonly mixerLateMs: LatenessSummary;
}

/** A frame clock that can change what drives it while it runs. */
export interface DeckFrameClock extends FrameClock {
  readonly source: TickSource;
  /** Hands the tick to `source` at once. A running clock stops the old source and starts the new one
   *  without dropping the frame count or the time owed; a stopped one only remembers it. No-op when unchanged. */
  setSource(source: TickSource): void;
  wakeReadings(): WakeReadings;
  resetWakeReadings(): void;
}

/**
 * Factories, not instances — each deck slot calls these to build its own clock and its own replay
 * threads rather than sharing them. Two frame clocks and four replay workers is the design: every
 * deck drives its own clock and owns two workers, one for jumps and one for prepared builds, never
 * shared with another deck.
 */
export const FRAME_CLOCK_FACTORY = new InjectionToken<() => DeckFrameClock>('FRAME_CLOCK_FACTORY');
export const REPLAY_RUNNER_FACTORY = new InjectionToken<() => ReplayRunner>(
  'REPLAY_RUNNER_FACTORY'
);
