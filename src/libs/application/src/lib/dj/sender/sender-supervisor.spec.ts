import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeClock, milliseconds } from '@sidablist/core';
import type { FrameClock, ReplayRunner } from '@sidablist/core';
import {
  ASID_SENDER_IDENTITY,
  ASID_SENDER_PROTOCOL_VERSION,
} from '@teensyrom-nx/asid-sender-protocol';
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
import type { Slot } from '../slot';
import {
  FakeRegisterRecorder,
  FakeReplayRunner,
  FakeSenderLink,
  SID_MODEL_8580,
  WRITING_TUNE,
  fakeMidiAccess,
  playableOf,
  recordOf,
  recordingPort,
  type RecordingPort,
} from '../testing/deck-runtime-fakes';
import { DeckSendRoute } from './deck-send-route';
import { SenderSupervisor } from './sender-supervisor';
import { START_GRACE_MS, TICK_MS } from './sender-health';

const IMAGE_LENGTH = 12 + 25;
const START_PACKET_LENGTH = 4;

describe('SenderSupervisor', () => {
  let supervisor: SenderSupervisor;
  let runtime: DeckRuntime;
  let route: DeckSendRoute;
  let link: FakeSenderLink;
  let timeline: string[];
  let ports: Record<Slot, RecordingPort>;
  let clocks: FakeClock[];
  let recorders: FakeRegisterRecorder[];
  let alertService: { warning: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };
  let nowMs: number;

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));
  const clockOf = (slot: Slot): FakeClock => clocks[slot === 'A' ? 0 : 1];

  beforeEach(() => {
    nowMs = 100_000;
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    timeline = [];
    clocks = [];
    recorders = [];
    link = new FakeSenderLink(timeline);
    ports = {
      A: recordingPort('port-a', { timeline }),
      B: recordingPort('port-b', { timeline }),
    };
    alertService = { warning: vi.fn(), info: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        { provide: ASID_SENDER_LINK, useValue: link },
        { provide: ALERT_SERVICE, useValue: alertService as unknown as IAlertService },
        {
          provide: FRAME_CLOCK_FACTORY,
          useValue: (): FrameClock => {
            const clock = new FakeClock();
            clocks.push(clock);
            return clock;
          },
        },
        { provide: REPLAY_RUNNER_FACTORY, useValue: (): ReplayRunner => new FakeReplayRunner() },
        {
          provide: REGISTER_RECORDER_FACTORY,
          useValue: (): RegisterRecorder => {
            const recorder = new FakeRegisterRecorder();
            recorders.push(recorder);
            return recorder;
          },
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function startPlaying(slot: Slot): Promise<void> {
    runtime.load(slot, playableOf(SID_MODEL_8580, WRITING_TUNE));
    await runtime.play(slot);
  }

  /** One frame on `slot`'s clock, due `aheadOfNowMs` from now. */
  function frame(slot: Slot, aheadOfNowMs = 5): void {
    clockOf(slot).tick(milliseconds(nowMs + aheadOfNowMs));
  }

  /** The link tick and the sender's answer to it, once every 250 ms for `ms`. */
  function elapse(ms: number): void {
    for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
      nowMs += TICK_MS;
      link.emit({ kind: 'tick' });
      link.emit({ kind: 'pong' });
    }
  }

  function frameLoads(tokens: readonly string[] = ['1234', '5678']): void {
    link.emit({ kind: 'loaded' });
    link.emit({
      kind: 'hello',
      identity: ASID_SENDER_IDENTITY,
      version: ASID_SENDER_PROTOCOL_VERSION,
    });
    link.emit({ kind: 'outputs', tokens });
    link.emit({ kind: 'ready', midi: true });
  }

  /** Starts the supervisor and brings the sender up through its own-thread test. `whileTesting`
   *  runs once the test has been asked and before it passes, so decks can be playing when the
   *  decks move onto the sender. */
  async function bringUp(
    whileTesting?: () => Promise<void>,
    listed: readonly string[] = ['1234', '5678']
  ): Promise<void> {
    supervisor.start();
    TestBed.flushEffects();
    frameLoads(listed);
    elapse(TICK_MS);
    await whileTesting?.();
    link.settleSelfTest('passed');
    await settle();
  }

  function fail(): void {
    link.emit({ kind: 'fault', fault: 'midi-lost', detail: 'unplugged' });
  }

  describe('starting', () => {
    it('opens the frame once MIDI is granted, and only once however often it is started', () => {
      supervisor.start();
      supervisor.start();
      TestBed.flushEffects();
      TestBed.flushEffects();

      expect(link.starts).toBe(1);
      expect(link.opens).toBe(1);
      expect(supervisor.state()).toBe('opening');
    });

    it('opens nothing until MIDI is granted', () => {
      const access = TestBed.inject(MIDI_ACCESS) as ReturnType<typeof fakeMidiAccess>;
      access.accessState.set('requesting');

      supervisor.start();
      TestBed.flushEffects();
      expect(link.opens).toBe(0);

      access.accessState.set('granted');
      TestBed.flushEffects();
      expect(link.opens).toBe(1);
    });

    it('warns once and opens nothing for an address with no other local name', () => {
      link.url = null;

      supervisor.start();
      TestBed.flushEffects();
      elapse(5000);

      expect(link.opens).toBe(0);
      expect(supervisor.state()).toBe('unavailable');
      expect(alertService.warning).toHaveBeenCalledExactlyOnceWith(
        "Timing helper isn't available here. Playing with standard timing."
      );
    });
  });

  describe('coming up', () => {
    it('moves both decks onto the sender at its lookahead, with the probes following', async () => {
      await bringUp(async () => {
        await startPlaying('A');
        await startPlaying('B');
      });

      frame('A');
      frame('B');

      expect(supervisor.state()).toBe('up');
      expect(route.path()).toBe('sender');
      const stamped = link.sends.filter((send) => send.dueAtMs !== undefined);
      expect(stamped.map((send) => send.dueAtMs)).toEqual([nowMs + 5 + 15, nowMs + 5 + 15]);
      const { decks } = (
        globalThis as unknown as {
          djBench: { report(): { decks: Record<string, { lagMs: { p50: number } }> } };
        }
      ).djBench.report();
      // A probe still at the mixer's lookahead of 0 would read these frames 20 ms early, not 5.
      expect([decks['A'].lagMs.p50, decks['B'].lagMs.p50]).toEqual([-5, -5]);
    });

    it('sends each playing deck its 25-register image first, unstamped, and no image to a deck that is not playing', async () => {
      await bringUp(() => startPlaying('A'));

      expect(link.sends.map((send) => [send.token, send.bytes.length, send.dueAtMs])).toEqual([
        ['1234', IMAGE_LENGTH, undefined],
      ]);
    });

    it('moves a paused deck the hand is running, and holds off the own-thread test while it runs', async () => {
      runtime.load('A', playableOf(SID_MODEL_8580, WRITING_TUNE));
      recorders[0].answer(0, recordOf(500));
      await settle();
      await runtime.play('A');
      runtime.pause('A');
      runtime.enterVarispeed('A', () => 1);
      expect(runtime.snapshot('A').transport).toBe('paused');

      supervisor.start();
      TestBed.flushEffects();
      frameLoads();
      elapse(1000);
      expect(timeline).not.toContain('link:self-test');
      expect(link.canHold).toHaveLength(0);

      runtime.stop('A');
      elapse(TICK_MS);
      expect(timeline).toContain('link:self-test');
      expect(link.canHold[0]()).toBe(true);

      await runtime.play('A');
      expect(link.canHold[0]()).toBe(false);
      runtime.pause('A');
      runtime.enterVarispeed('A', () => 1);
      expect(link.canHold[0]()).toBe(false);
      link.settleSelfTest('passed');
      await settle();
      expect(link.sends.map((send) => [send.token, send.bytes.length])).toEqual([
        ['1234', IMAGE_LENGTH],
      ]);
    });

    it('drops packets for a cartridge the sender does not list', async () => {
      await bringUp();
      link.emit({ kind: 'outputs', tokens: ['5678'] });

      runtime.identify('A', 'unlisted');
      runtime.identify('B', 'listed');

      expect(link.sends.map((send) => send.token)).toEqual(['5678']);
      expect(ports.A.sent).toHaveLength(0);
      expect(ports.B.sent).toHaveLength(0);
    });
  });

  describe('going down', () => {
    async function upWithBothDecksPlaying(): Promise<void> {
      await bringUp(async () => {
        await startPlaying('A');
        await startPlaying('B');
      });
      frame('A');
      frame('B');
    }

    it('closes the frame before the mixer port sees a single packet', async () => {
      await upWithBothDecksPlaying();
      const mark = timeline.length;

      fail();

      const after = timeline.slice(mark);
      expect(after.indexOf('link:close')).toBeGreaterThanOrEqual(0);
      expect(after.indexOf('mixer:send')).toBeGreaterThan(after.indexOf('link:close'));
      expect(route.path()).toBe('mixer');
    });

    it('puts the lookahead back and sends each playing deck its image unstamped, ahead of every later frame', async () => {
      await upWithBothDecksPlaying();

      fail();
      frame('A', 7);

      expect(ports.A.sent.at(-2)).toHaveLength(IMAGE_LENGTH);
      expect(ports.A.stamps.at(-2)).toBeUndefined();
      expect(ports.A.stamps.at(-1)).toBe(nowMs + 7);
      expect(ports.B.sent.at(-1)).toHaveLength(IMAGE_LENGTH);
      expect(ports.B.stamps.at(-1)).toBeUndefined();
    });

    it('lists no cartridge for the next sender until it says which', async () => {
      await upWithBothDecksPlaying();

      fail();

      expect(route.isListedBySender('1234')).toBe(false);
    });

    it('still goes back to the mixer when closing the frame throws', async () => {
      await upWithBothDecksPlaying();
      vi.spyOn(link, 'close').mockImplementation(() => {
        throw new Error('frame already gone');
      });
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      fail();

      expect(route.path()).toBe('mixer');
    });

    describe('what the decks sent in the moments before the sender was noticed', () => {
      const STOP = [0xf0, 0x2d, 0x4d, 0xf7];
      const START = [0xf0, 0x2d, 0x4c, 0xf7];
      const heardSince = (slot: Slot, mark: number): number[][] =>
        ports[slot].sent.slice(mark).map((packet) => Array.from(packet));

      it('sends the stop of a deck that ended after the sender last answered, since the sender may never have played it', async () => {
        await upWithBothDecksPlaying();
        elapse(TICK_MS);
        runtime.pause('A');
        const markA = ports.A.sent.length;
        const markB = ports.B.sent.length;

        fail();

        expect(heardSince('A', markA)).toEqual([STOP]);
        expect(heardSince('B', markB)).toHaveLength(1);
      });

      it('sends the start handshake of a deck that began after the sender last answered, ahead of its image', async () => {
        await bringUp();
        elapse(TICK_MS);
        await startPlaying('A');
        const mark = ports.A.sent.length;

        fail();

        const heard = heardSince('A', mark);
        expect(heard).toHaveLength(3);
        expect(heard[0].slice(0, 3)).toEqual([0xf0, 0x2d, 0x32]);
        expect(heard[1]).toEqual(START);
        expect(heard[2].length).toBeGreaterThan(START_PACKET_LENGTH);
      });

      it('sends a deck whose transport did not change nothing but its image', async () => {
        await upWithBothDecksPlaying();
        elapse(TICK_MS);
        const markA = ports.A.sent.length;
        const markB = ports.B.sent.length;

        fail();

        expect(heardSince('A', markA)).toHaveLength(1);
        expect(heardSince('B', markB)).toHaveLength(1);
      });

      it('replays nothing for a failure before the decks were on the sender, since they sent from the mixer', async () => {
        supervisor.start();
        TestBed.flushEffects();
        frameLoads();
        elapse(TICK_MS);
        await startPlaying('A');
        const mark = ports.A.sent.length;

        fail();

        const heard = heardSince('A', mark);
        expect(heard).not.toContainEqual(START);
        expect(heard).not.toContainEqual(STOP);
      });
    });
  });

  describe('cartridges coming back', () => {
    async function upOnTheSender(listed: readonly string[]): Promise<void> {
      await bringUp(() => startPlaying('A'), listed);
      link.sends.length = 0;
    }

    function handshakeThenFrame(): void {
      expect(link.sends.map((send) => send.token)).toEqual(['1234', '1234', '1234']);
      expect(link.sends[1].bytes).toHaveLength(START_PACKET_LENGTH);
      expect(link.sends[2].bytes.length).toBeGreaterThan(START_PACKET_LENGTH);
    }

    it('hears the start handshake before its next frame when the app port returns first', async () => {
      await upOnTheSender(['5678']);

      runtime.resync('A');
      expect(link.sends).toHaveLength(0);
      link.emit({ kind: 'outputs', tokens: ['1234', '5678'] });
      frame('A');

      handshakeThenFrame();
    });

    it('hears the start handshake before its next frame when the sender lists it first', async () => {
      await upOnTheSender(['5678']);
      runtime.setPort('A', null);
      link.emit({ kind: 'outputs', tokens: ['1234', '5678'] });
      expect(link.sends).toHaveLength(0);

      runtime.setPort('A', 'port-a');
      runtime.resync('A');
      frame('A');

      handshakeThenFrame();
    });

    it('is not repeated for a cartridge the sender already listed', async () => {
      await upOnTheSender(['1234']);

      link.emit({ kind: 'outputs', tokens: ['1234', '5678'] });

      expect(link.sends).toHaveLength(0);
    });

    it('is not sent to a deck that is not playing or paused', async () => {
      runtime.load('A', playableOf(SID_MODEL_8580, WRITING_TUNE));
      await bringUp(undefined, []);

      link.emit({ kind: 'outputs', tokens: ['1234'] });

      expect(link.sends).toHaveLength(0);
    });
  });

  describe('the alerts', () => {
    it('warns that the helper stopped once the grace has passed, and says when it is back', async () => {
      await bringUp();
      elapse(START_GRACE_MS);

      fail();
      expect(alertService.warning).toHaveBeenCalledExactlyOnceWith(
        'Timing helper stopped. Playing with reduced timing while it recovers.'
      );

      elapse(1000);
      frameLoads();
      expect(supervisor.state()).toBe('up');
      expect(alertService.info).toHaveBeenCalledExactlyOnceWith(
        'Timing helper is back. Full timing restored.'
      );
    });

    it('stays quiet about a helper that fails while the app is still starting', async () => {
      await bringUp();

      fail();

      expect(alertService.warning).not.toHaveBeenCalled();
    });

    it('warns that the helper is not available when the own-thread test fails', async () => {
      supervisor.start();
      TestBed.flushEffects();
      frameLoads();
      elapse(TICK_MS);

      link.settleSelfTest('failed');
      await settle();

      expect(link.closes).toBe(1);
      expect(alertService.warning).toHaveBeenCalledExactlyOnceWith(
        "Timing helper isn't available here. Playing with standard timing."
      );
    });
  });

  describe('the dev keys', () => {
    it('flip parks the decks on the mixer and back onto the sender', async () => {
      await bringUp();

      supervisor.flip();
      expect(supervisor.state()).toBe('parked');
      expect(route.path()).toBe('mixer');
      expect(link.closes).toBe(1);

      supervisor.flip();
      frameLoads();
      expect(supervisor.state()).toBe('up');
      expect(route.path()).toBe('sender');
    });

    it('break fails the sender the way a real failure does', async () => {
      await bringUp();

      supervisor.breakOnPurpose();

      expect(supervisor.state()).toBe('down');
      expect(route.path()).toBe('mixer');
      expect(link.closes).toBe(1);
    });
  });
});

describe('SenderSupervisor with no link', () => {
  it('does nothing when started', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ALERT_SERVICE, useValue: { warning: vi.fn(), info: vi.fn() } },
        { provide: MIDI_ACCESS, useValue: fakeMidiAccess(() => null) },
        { provide: FRAME_CLOCK_FACTORY, useValue: (): FrameClock => new FakeClock() },
        { provide: REPLAY_RUNNER_FACTORY, useValue: (): ReplayRunner => new FakeReplayRunner() },
        {
          provide: REGISTER_RECORDER_FACTORY,
          useValue: (): RegisterRecorder => new FakeRegisterRecorder(),
        },
      ],
    });
    const supervisor = TestBed.inject(SenderSupervisor);

    supervisor.start();
    TestBed.flushEffects();

    expect(supervisor.state()).toBe('idle');
    expect(TestBed.inject(DeckSendRoute).path()).toBe('mixer');
  });
});
