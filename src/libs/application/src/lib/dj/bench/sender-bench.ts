import { milliseconds } from '@sidablist/core';
import type {
  CartridgeTiming,
  LatenessSummary,
  TimelineRow,
} from '@teensyrom-nx/asid-sender-protocol';
import type { DeckRuntime } from '../deck-runtime';
import type { IAsidSenderLink } from '../ports';
import { DECK_SLOTS, type Slot } from '../slot';
import type { DeckSendRoute, SendPath } from '../sender/deck-send-route';
import type { SenderHealthState } from '../sender/sender-health';

export interface SenderBenchDeps {
  readonly supervisor: {
    readonly state: () => SenderHealthState;
    flip(): void;
    breakOnPurpose(): void;
  };
  readonly route: DeckSendRoute;
  readonly runtime: DeckRuntime;
  readonly link: IAsidSenderLink;
}

export interface SenderBench {
  /** Removes the key listener and the commands this bench added. */
  uninstall(): void;
}

export interface SenderReading {
  path: SendPath;
  state: SenderHealthState;
  marginMs: { now: number; max: number };
  wake: LatenessSummary;
  decks: Partial<Record<Slot, CartridgeTiming>>;
  timeline: TimelineRow[];
  visibility: { atS: number; state: 'visible' | 'hidden' }[];
}

type BenchHandle = Record<string, unknown> & {
  reset?: () => void;
  lookahead?: (ms: number) => number[];
};

let installed: SenderBench | null = null;

/**
 * Dev builds only, from inside an injection context: the sender's bench tools — the `i` and `b`
 * keys, and `djBench.sender()`, `lookahead` and `reset` on the handle the runtime
 * installed. One bench lives per window: installing again first removes the earlier one.
 */
export function installSenderBench(deps: SenderBenchDeps): SenderBench {
  installed?.uninstall();

  const { supervisor, route, runtime, link } = deps;

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'i' && event.key !== 'b') {
      return;
    }
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
      return;
    }
    const focused = document.activeElement;
    if (focused !== null && focused !== document.body) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'i') {
      supervisor.flip();
    } else {
      supervisor.breakOnPurpose();
    }
  };
  window.addEventListener('keydown', onKeyDown, true);

  const restores: (() => void)[] = [];
  const bench = (globalThis as { djBench?: BenchHandle }).djBench;
  if (bench) {
    const originalReset = bench.reset;
    const originalLookahead = bench.lookahead;
    bench.reset = (): void => {
      originalReset?.();
      link.clearTiming();
    };
    bench.lookahead = (ms: number): number[] => {
      route.setLookahead(route.path(), milliseconds(ms));
      return DECK_SLOTS.map((slot) => {
        runtime.setScheduleAhead(slot, route.lookaheadFor(route.path()));
        return runtime.scheduleAheadOf(slot);
      });
    };
    bench['sender'] = async (): Promise<SenderReading> => {
      const report = await link.readTiming();
      const decks: Partial<Record<Slot, CartridgeTiming>> = {};
      for (const slot of DECK_SLOTS) {
        const token = runtime.deviceToken(slot);
        const timing = report?.cartridges.find((cartridge) => cartridge.token === token);
        if (token !== null && timing !== undefined) {
          decks[slot] = timing;
        }
      }
      const result: SenderReading = {
        path: route.path(),
        state: supervisor.state(),
        marginMs: report ? { ...report.marginMs } : { now: 0, max: 0 },
        wake: report ? { ...report.wake } : { count: 0, p50: 0, p99: 0, max: 0 },
        decks,
        timeline: report ? [...report.timeline] : [],
        visibility: report ? [...report.visibility] : [],
      };
      // eslint-disable-next-line no-console -- the bench is a console tool; printing is its output
      console.log(JSON.stringify(result, null, 2));
      return result;
    };
    restores.push(() => {
      bench.reset = originalReset;
      bench.lookahead = originalLookahead;
      delete bench['sender'];
    });
  }

  const handle: SenderBench = {
    uninstall(): void {
      window.removeEventListener('keydown', onKeyDown, true);
      restores.forEach((restore) => restore());
      if (installed === handle) {
        installed = null;
      }
    },
  };
  installed = handle;
  return handle;
}
