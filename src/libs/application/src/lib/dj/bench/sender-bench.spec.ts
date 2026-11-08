import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeClock } from '@sidablist/core';
import type { FrameClock, ReplayRunner } from '@sidablist/core';
import {
  ASID_SENDER_IDENTITY,
  ASID_SENDER_PROTOCOL_VERSION,
} from '@teensyrom-nx/asid-sender-protocol';
import type { CartridgeTiming, SenderTimingReport } from '@teensyrom-nx/asid-sender-protocol';
import { ALERT_SERVICE, type IAlertService } from '@teensyrom-nx/domain';
import { DeckRuntime } from '../deck-runtime';
import {
  ASID_SENDER_LINK,
  FRAME_CLOCK_FACTORY,
  MIDI_ACCESS,
  REGISTER_RECORDER_FACTORY,
  REPLAY_RUNNER_FACTORY,
} from '../ports';
import type { RegisterRecorder } from '../ports';
import { DeckSendRoute } from '../sender/deck-send-route';
import { TICK_MS } from '../sender/sender-health';
import { SenderSupervisor } from '../sender/sender-supervisor';
import {
  FakeRegisterRecorder,
  FakeReplayRunner,
  FakeSenderLink,
  SID_MODEL_8580,
  WRITING_TUNE,
  fakeMidiAccess,
  playableOf,
  recordingPort,
} from '../testing/deck-runtime-fakes';
import { installSenderBench, type SenderBench, type SenderReading } from './sender-bench';

interface BenchCommands {
  lookahead(ms: number): number[];
  reset(): void;
  sender(): Promise<SenderReading>;
}

function cartridge(token: string): CartridgeTiming {
  return {
    token,
    packets: 10,
    arrival: { pastDue: 0, pastDueMaxMs: 0, spareMinMs: 1, spareP1Ms: 2, spareP50Ms: 3 },
    send: { count: 10, p50: 0.1, p99: 0.4, max: 1, ownOver2Ms: 0, ownOver5Ms: 0, ownMaxMs: 0.5 },
    gaps: { medianMs: 10, within1MsPct: 99, offOver5Ms: 0 },
    failedSends: 0,
    dropped: 0,
  };
}

describe('sender bench', () => {
  let supervisor: SenderSupervisor;
  let runtime: DeckRuntime;
  let route: DeckSendRoute;
  let link: FakeSenderLink;
  let timeline: string[];
  let bench: SenderBench;
  let nowMs: number;

  const commands = (): BenchCommands =>
    (globalThis as unknown as { djBench: BenchCommands }).djBench;
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

  function press(init: KeyboardEventInit): void {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    );
  }

  function install(): SenderBench {
    return TestBed.runInInjectionContext(() =>
      installSenderBench({ supervisor, route, runtime, link })
    );
  }

  function frameLoads(): void {
    link.emit({ kind: 'loaded' });
    link.emit({
      kind: 'hello',
      identity: ASID_SENDER_IDENTITY,
      version: ASID_SENDER_PROTOCOL_VERSION,
    });
    link.emit({ kind: 'outputs', tokens: ['1234', '5678'] });
    link.emit({ kind: 'ready', midi: true });
  }

  /** Brings the sender up with deck A playing, then takes over the bench from the one `start` installed. */
  async function bringUp(): Promise<void> {
    supervisor.start();
    TestBed.flushEffects();
    frameLoads();
    nowMs += TICK_MS;
    link.emit({ kind: 'tick' });
    link.emit({ kind: 'pong' });
    runtime.load('A', playableOf(SID_MODEL_8580, WRITING_TUNE));
    await runtime.play('A');
    link.settleSelfTest('passed');
    await settle();
    bench = install();
  }

  beforeEach(() => {
    nowMs = 100_000;
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    timeline = [];
    link = new FakeSenderLink(timeline);
    const ports = {
      A: recordingPort('port-a', { timeline }),
      B: recordingPort('port-b', { timeline }),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ASID_SENDER_LINK, useValue: link },
        {
          provide: ALERT_SERVICE,
          useValue: { warning: vi.fn(), info: vi.fn() } as unknown as IAlertService,
        },
        { provide: FRAME_CLOCK_FACTORY, useValue: (): FrameClock => new FakeClock() },
        { provide: REPLAY_RUNNER_FACTORY, useValue: (): ReplayRunner => new FakeReplayRunner() },
        {
          provide: REGISTER_RECORDER_FACTORY,
          useValue: (): RegisterRecorder => new FakeRegisterRecorder(),
        },
        {
          provide: MIDI_ACCESS,
          useValue: fakeMidiAccess(
            (id) => (id === 'port-a' ? ports.A : id === 'port-b' ? ports.B : null),
            [
              { id: 'port-a', name: 'TeensyROM-1234 MIDI', manufacturer: '' },
              { id: 'port-b', name: 'TeensyROM-5678 MIDI', manufacturer: '' },
            ]
          ),
        },
      ],
    });
    supervisor = TestBed.inject(SenderSupervisor);
    runtime = TestBed.inject(DeckRuntime);
    route = TestBed.inject(DeckSendRoute);
    runtime.build('A');
    runtime.build('B');
    runtime.setPort('A', 'port-a');
    runtime.setPort('B', 'port-b');
    bench = install();
  });

  afterEach(() => {
    bench.uninstall();
    vi.restoreAllMocks();
  });

  describe('keys', () => {
    it('i parks the decks on the mixer before any packet goes out, and brings the sender back', async () => {
      await bringUp();
      expect(supervisor.state()).toBe('up');
      const before = timeline.length;

      press({ key: 'i' });

      expect(supervisor.state()).toBe('parked');
      expect(route.path()).toBe('mixer');
      expect(link.closes).toBe(1);
      const afterFlip = timeline.slice(before);
      expect(afterFlip).toContain('mixer:send');
      expect(afterFlip.indexOf('link:close')).toBeLessThan(afterFlip.indexOf('mixer:send'));

      press({ key: 'i' });
      frameLoads();

      expect(supervisor.state()).toBe('up');
      expect(route.path()).toBe('sender');
    });

    it('b breaks the sender the way a real failure does', async () => {
      await bringUp();

      press({ key: 'b' });

      expect(supervisor.state()).toBe('down');
      expect(route.path()).toBe('mixer');
      expect(link.closes).toBe(1);
    });

    it('ignores a key with focus in an input, a modifier held, a repeat, or another key', async () => {
      await bringUp();
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      press({ key: 'i' });
      input.remove();
      press({ key: 'i', ctrlKey: true });
      press({ key: 'i', altKey: true });
      press({ key: 'i', metaKey: true });
      press({ key: 'I', shiftKey: true });
      press({ key: 'i', repeat: true });
      press({ key: 'x' });

      expect(supervisor.state()).toBe('up');
      expect(link.closes).toBe(0);
    });

    it('takes the key from everything else when it acts', () => {
      const elsewhere = vi.fn();
      window.addEventListener('keydown', elsewhere, true);
      try {
        const other = new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true });
        window.dispatchEvent(other);
        expect(elsewhere).toHaveBeenCalledTimes(1);
        expect(other.defaultPrevented).toBe(false);

        const event = new KeyboardEvent('keydown', { key: 'i', bubbles: true, cancelable: true });
        window.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(elsewhere).toHaveBeenCalledTimes(1);
      } finally {
        window.removeEventListener('keydown', elsewhere, true);
      }
    });
  });

  describe('install', () => {
    it('leaves exactly one listener after a second install', () => {
      const flip = vi.fn();
      const stub = { state: () => 'up' as const, flip, breakOnPurpose: vi.fn() };
      TestBed.runInInjectionContext(() => {
        installSenderBench({ supervisor: stub, route, runtime, link });
        bench = installSenderBench({ supervisor: stub, route, runtime, link });
      });

      press({ key: 'i' });

      expect(flip).toHaveBeenCalledTimes(1);
    });

    it('puts no visible element on the page', async () => {
      await bringUp();

      expect(document.body.textContent).not.toContain('SEND:');
    });
  });

  describe('commands', () => {
    it('lookahead sets the live path only and the other path keeps its own', () => {
      expect(route.path()).toBe('mixer');
      const sender = route.lookaheadFor('sender');

      const effective = commands().lookahead(7);

      expect(effective).toEqual([7, 7]);
      expect(route.lookaheadFor('mixer')).toBe(7);
      expect(route.lookaheadFor('sender')).toBe(sender);
    });

    it('lookahead on the sender path sets the sender value and leaves the mixer one alone', async () => {
      await bringUp();
      expect(route.path()).toBe('sender');
      const mixer = route.lookaheadFor('mixer');

      const effective = commands().lookahead(7);

      expect(effective).toEqual([7, 7]);
      expect(route.lookaheadFor('sender')).toBe(7);
      expect(route.lookaheadFor('mixer')).toBe(mixer);
    });

    it('reset clears the sender record through the link', () => {
      commands().reset();

      expect(link.timingClears).toBe(1);
    });

    it('sender maps the cartridges to their decks', async () => {
      const report: SenderTimingReport = {
        sinceS: 5,
        marginMs: { now: 4, max: 9 },
        wake: { count: 3, p50: 0.2, p99: 0.9, max: 1 },
        cartridges: [cartridge('5678'), cartridge('9999')],
        timeline: [],
        visibility: [{ atS: 1, state: 'hidden' }],
        appQuietMaxMs: 0,
      };
      link.timing = report;

      const reading = await commands().sender();

      expect(Object.keys(reading.decks)).toEqual(['B']);
      expect(reading.decks.B?.token).toBe('5678');
      expect(reading.answered).toBe(true);
      expect(reading.marginMs).toEqual({ now: 4, max: 9 });
      expect(reading.wake).toEqual({ count: 3, p50: 0.2, p99: 0.9, max: 1 });
      expect(reading.visibility).toEqual([{ atS: 1, state: 'hidden' }]);
      expect(reading.path).toBe('mixer');
    });

    it('sender says it got no reading, rather than reading zero, when the sender does not answer', async () => {
      const reading = await commands().sender();

      expect(reading.answered).toBe(false);
      expect(reading.marginMs).toBeNull();
      expect(reading.wake).toBeNull();
      expect(reading.decks).toEqual({});
      expect(reading.timeline).toEqual([]);
      expect(reading.visibility).toEqual([]);
    });
  });
});
