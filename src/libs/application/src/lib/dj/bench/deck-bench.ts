import { isDevMode } from '@angular/core';
import { milliseconds } from '@sidablist/core';
import type { SidPlayer } from '@sidablist/core';
import type { AsidSink } from '@sidablist/asid';
import type { Slot } from '../slot';
import type { DeliveryProbe } from './delivery-probe';

export interface BenchDeck {
  readonly slot: Slot;
  readonly player: SidPlayer;
  readonly sink: AsidSink;
  readonly probe: DeliveryProbe;
}

const HELP = `djBench — deck timing bench (dev builds only)
  djBench.report()               timing per playing deck since the last reset
  djBench.reset()                clears the probes and long-task count (clock and player stats reset on play); with the sender, also its timing record
  djBench.lookahead(ms)          sets the live send path's schedule-ahead on both decks (the sink caps it at 40 ms); the other path keeps its own value for this page load
  djBench.sender()               Promise: the sender's path, health, margin, wake lateness and per-deck timing (empty decks with no cartridge)
  keys i / b                     with nothing focused: i flips between the sender and today's sending; b breaks the sender on purpose (the self-heal drill); the badge bottom-left shows the path
  djBench.waves(false|true)      the whole waveform feature off (the baseline) or on, with the hand-off timed
  djBench.history(on)            only the engine's delivery history, on both decks (64) or off; use with waves(false)
  djBench.waveReport()           Promise: feed counters (paints, entries, dropped, pool misses, hand-off ms) and the worker's draws`;

/**
 * Puts `djBench` on the window: a console handle onto each deck's delivery probe, player stats and
 * sink. Bench tooling for finding where delivery jitter comes from — dev builds only, and nothing in
 * the application calls it.
 */
export function installDeckBench(decks: () => readonly BenchDeck[]): void {
  let longTasks = 0;
  let longestTaskMs = 0;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks++;
        longestTaskMs = Math.max(longestTaskMs, entry.duration);
      }
    }).observe({ type: 'longtask' });
  } catch {
    // No long-task timing in this browser; the count stays at zero.
  }

  const bench = {
    help(): void {
      // eslint-disable-next-line no-console -- the bench is a console tool; printing is its output
      console.log(HELP);
    },

    report(): unknown {
      const result = {
        devMode: isDevMode(),
        reduxDevtools: '__REDUX_DEVTOOLS_EXTENSION__' in window,
        longTasks: { count: longTasks, longestMs: Math.round(longestTaskMs) },
        decks: Object.fromEntries(
          decks()
            .map(({ slot, player, sink, probe }) => {
              const stats = player.getStats();
              const summary = probe.summarize(stats.effectiveIntervalUs / 1000);
              return [
                slot,
                summary.frames === 0
                  ? null
                  : {
                      scheduleAheadMs: sink.capabilities.scheduleAheadMs,
                      ...summary,
                      clock: {
                        jitterMs: round(stats.clock.jitterMs),
                        worstGapMs: round(stats.clock.worstGapMs),
                        lateCallbacks: stats.clock.lateCallbacks,
                      },
                      player: {
                        lateFrames: stats.delivery.lateFrames,
                        meanLagMs: round(stats.delivery.meanLagMs),
                        worstLagMs: round(stats.delivery.worstLagMs),
                      },
                    },
              ] as const;
            })
            .filter(([, deck]) => deck !== null)
        ),
      };
      // eslint-disable-next-line no-console -- the bench is a console tool; printing is its output
      console.log(JSON.stringify(result, null, 2));
      return result;
    },

    reset(): void {
      for (const { probe } of decks()) {
        probe.reset();
      }
      longTasks = 0;
      longestTaskMs = 0;
    },

    lookahead(ms: number): number[] {
      return decks().map(({ sink, probe }) => {
        sink.setScheduleAhead(milliseconds(ms));
        const effective = sink.capabilities.scheduleAheadMs ?? 0;
        probe.setScheduleAhead(effective);
        probe.reset();
        return effective;
      });
    },
  };

  (globalThis as { djBench?: typeof bench }).djBench = bench;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
