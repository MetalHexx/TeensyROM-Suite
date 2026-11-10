import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeClock, frames, milliseconds } from '@sidablist/core';
import type { FrameClock, ReplayRunner, SidPlayer } from '@sidablist/core';
import type { MidiOutputPort } from '@sidablist/asid';
import { DeckRuntime } from './deck-runtime';
import {
  FRAME_CLOCK_FACTORY,
  REPLAY_RUNNER_FACTORY,
  REGISTER_RECORDER_FACTORY,
  MIDI_ACCESS,
  ASID_SENDER_LINK,
} from './ports';
import type { RegisterRecorder } from './ports';
import { DeckSendRoute, SENDER_SCHEDULE_AHEAD_MS } from './sender/deck-send-route';
import {
  FakeRegisterRecorder,
  FakeReplayRunner,
  SID_MODEL_6581,
  SID_MODEL_8580,
  fakeMidiAccess,
  playableOf,
  recordOf,
  recordingPort,
  FakeSenderLink,
  WRITING_TUNE,
  type RecordingPort,
} from './testing/deck-runtime-fakes';

const createdPlayers = vi.hoisted((): unknown[] => []);

// The runtime keeps its players private, so the real `createSidPlayer` is wrapped to hand each
// built player to the specs.
vi.mock('@sidablist/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sidablist/core')>();
  return {
    ...actual,
    createSidPlayer: (...args: Parameters<typeof actual.createSidPlayer>) => {
      const player = actual.createSidPlayer(...args);
      createdPlayers.push(player);
      return player;
    },
  };
});

describe('DeckRuntime', () => {
  let runtime: DeckRuntime;
  let clockFactory: ReturnType<typeof vi.fn>;
  let replayFactory: ReturnType<typeof vi.fn>;
  let replayRunners: FakeReplayRunner[];
  let recorders: FakeRegisterRecorder[];
  let outputPortFor: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createdPlayers.length = 0;
    replayRunners = [];
    recorders = [];
    clockFactory = vi.fn((): FrameClock => new FakeClock());
    replayFactory = vi.fn((): ReplayRunner => {
      const runner = new FakeReplayRunner();
      replayRunners.push(runner);
      return runner;
    });
    outputPortFor = vi.fn((): MidiOutputPort | null => null);

    TestBed.configureTestingModule({
      providers: [
        DeckRuntime,
        { provide: FRAME_CLOCK_FACTORY, useValue: clockFactory },
        { provide: REPLAY_RUNNER_FACTORY, useValue: replayFactory },
        {
          provide: REGISTER_RECORDER_FACTORY,
          useValue: (): RegisterRecorder => {
            const recorder = new FakeRegisterRecorder();
            recorders.push(recorder);
            return recorder;
          },
        },
        { provide: MIDI_ACCESS, useValue: fakeMidiAccess((id) => outputPortFor(id) as MidiOutputPort | null) },
      ],
    });
    runtime = TestBed.inject(DeckRuntime);
  });

  it('builds a slot once: a second build call does not rebuild its clock or replay threads', () => {
    runtime.build('A');
    runtime.build('A');

    expect(clockFactory).toHaveBeenCalledTimes(1);
    expect(replayFactory).toHaveBeenCalledTimes(2);
  });

  it('builds each slot its own clock and its own pair of replay threads, one for jumps and one for prepared builds', () => {
    runtime.build('A');
    runtime.build('B');

    expect(clockFactory).toHaveBeenCalledTimes(2);
    expect(replayFactory).toHaveBeenCalledTimes(4);
    expect(new Set(replayRunners).size).toBe(4);
  });

  it('drops bytes with nothing bound, never reaching the MIDI access port lookup', () => {
    runtime.build('A');

    runtime.identify('A', 'hello');

    expect(outputPortFor).not.toHaveBeenCalled();
  });

  it("re-resolves the façade's target on every send rather than caching it", () => {
    runtime.build('A');
    const port = recordingPort('port-1');
    outputPortFor.mockReturnValue(port);
    runtime.setPort('A', 'port-1');

    runtime.identify('A', 'one');
    runtime.identify('A', 'two');

    expect(outputPortFor).toHaveBeenCalledTimes(2);
    expect(outputPortFor).toHaveBeenCalledWith('port-1');
    expect(port.sent).toHaveLength(2);
  });

  it('drops bytes again once a previously bound port stops resolving', () => {
    runtime.build('A');
    const port = recordingPort('port-1');
    outputPortFor.mockReturnValue(port);
    runtime.setPort('A', 'port-1');
    runtime.identify('A', 'one');

    outputPortFor.mockReturnValue(null);
    runtime.identify('A', 'two');

    expect(port.sent).toHaveLength(1);
  });

  describe('resync', () => {
    /** The SID-type packet's chip flag, then the start packet — what `AsidSink.begin` sends. */
    function handshake(port: { readonly sent: readonly Uint8Array[] }) {
      return { count: port.sent.length, is8580: port.sent[0]?.[4] === 1, startLength: port.sent[1]?.length };
    }

    it("re-sends the loaded tune's SID type and the start packet through the slot's port", () => {
      runtime.build('A');
      const port = recordingPort('port-1');
      outputPortFor.mockReturnValue(port);
      runtime.setPort('A', 'port-1');
      runtime.load('A', playableOf(SID_MODEL_8580));

      runtime.resync('A');

      expect(handshake(port)).toEqual({ count: 2, is8580: true, startLength: 4 });
    });

    it('uses the chip model of the tune loaded last', () => {
      runtime.build('A');
      const port = recordingPort('port-1');
      outputPortFor.mockReturnValue(port);
      runtime.setPort('A', 'port-1');
      runtime.load('A', playableOf(SID_MODEL_8580));
      runtime.load('A', playableOf(SID_MODEL_6581));

      runtime.resync('A');

      expect(handshake(port).is8580).toBe(false);
    });

    it('does nothing when no tune is loaded', () => {
      runtime.build('A');
      const port = recordingPort('port-1');
      outputPortFor.mockReturnValue(port);
      runtime.setPort('A', 'port-1');

      runtime.resync('A');

      expect(port.sent).toHaveLength(0);
    });

    it("sends nothing to the other slot's port", () => {
      runtime.build('A');
      runtime.build('B');
      const portB = recordingPort('port-b');
      outputPortFor.mockImplementation((id: string) => (id === 'port-b' ? portB : null));
      runtime.setPort('B', 'port-b');
      runtime.load('A', playableOf(SID_MODEL_8580));

      runtime.resync('A');

      expect(portB.sent).toHaveLength(0);
    });
  });

  it('disposes the built player, releasing both of its replay threads', () => {
    runtime.build('A');

    runtime.dispose('A');

    expect(replayRunners.map((runner) => runner.disposed)).toEqual([true, true]);
  });

  it("disposing one slot leaves the other slot's player untouched", () => {
    runtime.build('A');
    runtime.build('B');

    runtime.dispose('A');

    expect(replayRunners.map((runner) => runner.disposed)).toEqual([true, true, false, false]);
  });

  it("disposes the recorder with the player, and only that slot's", () => {
    runtime.build('A');
    runtime.build('B');

    runtime.dispose('A');

    expect(recorders.map((recorder) => recorder.disposed)).toEqual([true, false]);
  });

  describe('the register record', () => {
    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));
    let setRecord: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      runtime.build('A');
      setRecord = vi
        .spyOn(createdPlayers[0] as SidPlayer, 'setRegisterRecord')
        .mockImplementation(() => undefined);
    });

    it('is requested for the loaded subtune, covering the position basis, the ceiling and five seconds more', () => {
      const playable = playableOf(SID_MODEL_6581);

      runtime.load('A', playable);

      const { basis } = runtime.snapshot('A');
      const margin = Math.round(5e6 / runtime.playCallIntervalUs('A'));
      expect(recorders[0].requests).toHaveLength(1);
      expect(recorders[0].requests[0].bytes).toBe(playable.bytes);
      expect(recorders[0].requests[0].subtune).toBe(1);
      expect(recorders[0].requests[0].frames).toBe(
        Math.max(basis.positionBasisFrames, basis.ceilingFrames) + margin
      );
    });

    it('is requested again for a reload, since a subtune switch loads through the same call', () => {
      runtime.load('A', playableOf(SID_MODEL_6581));
      runtime.load('A', playableOf(SID_MODEL_8580));

      expect(recorders[0].requests).toHaveLength(2);
    });

    it('goes to the player when it arrives', async () => {
      runtime.load('A', playableOf(SID_MODEL_6581));
      const record = recordOf(10);

      recorders[0].answer(0, record);
      await settle();

      expect(setRecord).toHaveBeenCalledExactlyOnceWith(record);
    });

    it('is not set once a newer load has been made, whichever answer comes first', async () => {
      runtime.load('A', playableOf(SID_MODEL_6581));
      runtime.load('A', playableOf(SID_MODEL_8580));
      const stale = recordOf(10);
      const current = recordOf(20);

      recorders[0].answer(1, current);
      recorders[0].answer(0, stale);
      await settle();

      expect(setRecord).toHaveBeenCalledExactlyOnceWith(current);
    });

    it("keeps the note starts of the slot's record: none until it arrives, and none again on the next load", async () => {
      runtime.load('A', playableOf(SID_MODEL_6581));
      expect(runtime.noteStarts('A')).toBeNull();

      recorders[0].answer(0, recordOf(10));
      await settle();
      expect(runtime.noteStarts('A')).not.toBeNull();

      runtime.load('A', playableOf(SID_MODEL_8580));
      expect(runtime.noteStarts('A')).toBeNull();
    });

    it('ignores the note starts of a record a newer load has overtaken', async () => {
      runtime.load('A', playableOf(SID_MODEL_6581));
      runtime.load('A', playableOf(SID_MODEL_8580));

      recorders[0].answer(0, recordOf(10));
      await settle();

      expect(runtime.noteStarts('A')).toBeNull();
    });

    it('is simply not set when the scan fails, with a null answer or a rejection', async () => {
      runtime.load('A', playableOf(SID_MODEL_6581));
      runtime.load('A', playableOf(SID_MODEL_6581));

      recorders[0].answer(0, null);
      recorders[0].fail(1, new Error('worker gone'));
      await settle();

      expect(setRecord).not.toHaveBeenCalled();
    });

    it("asks the slot's own recorder", () => {
      runtime.build('B');

      runtime.load('B', playableOf(SID_MODEL_6581));

      expect(recorders[0].requests).toHaveLength(0);
      expect(recorders[1].requests).toHaveLength(1);
    });

    it("hands varispeed to the slot's player and takes it back", () => {
      const player = createdPlayers[0] as SidPlayer;
      const enter = vi.spyOn(player, 'enterVarispeed').mockReturnValue(true);
      const leave = vi.spyOn(player, 'leaveVarispeed').mockImplementation(() => undefined);
      const source = (): number => 0;

      expect(runtime.enterVarispeed('A', source)).toBe(true);
      runtime.leaveVarispeed('A');

      expect(enter).toHaveBeenCalledExactlyOnceWith(source);
      expect(leave).toHaveBeenCalledTimes(1);
    });
  });

  describe('engine controls', () => {
    function playerFor(index: number): SidPlayer {
      return createdPlayers[index] as SidPlayer;
    }

    beforeEach(() => {
      runtime.build('A');
      runtime.build('B');
    });

    it('setVoicePitch reaches only the named slot and voice, with the multiplier', () => {
      const a = vi.spyOn(playerFor(0), 'setVoicePitch');
      const b = vi.spyOn(playerFor(1), 'setVoicePitch');

      runtime.setVoicePitch('A', 2, 1.5);

      expect(a).toHaveBeenCalledExactlyOnceWith(2, 1.5);
      expect(b).not.toHaveBeenCalled();
    });

    it("setTargetClock reaches only the named slot's player, a clock or none", () => {
      const a = vi.spyOn(playerFor(0), 'setTargetClock');
      const b = vi.spyOn(playerFor(1), 'setTargetClock');

      runtime.setTargetClock('A', 985248.6);
      runtime.setTargetClock('A', null);

      expect(a.mock.calls).toEqual([[985248.6], [null]]);
      expect(b).not.toHaveBeenCalled();
    });

    it('setFieldOffset sets a non-zero offset and clears the field at 0', () => {
      const set = vi.spyOn(playerFor(0), 'setFieldOffset');
      const clear = vi.spyOn(playerFor(0), 'clearFieldOffset');
      const otherSet = vi.spyOn(playerFor(1), 'setFieldOffset');
      const otherClear = vi.spyOn(playerFor(1), 'clearFieldOffset');

      runtime.setFieldOffset('A', { name: 'attack', voice: 1 }, -3);
      runtime.setFieldOffset('A', { name: 'cutoff' }, 0);

      expect(set).toHaveBeenCalledExactlyOnceWith({ name: 'attack', voice: 1 }, -3);
      expect(clear).toHaveBeenCalledExactlyOnceWith({ name: 'cutoff' });
      expect(otherSet).not.toHaveBeenCalled();
      expect(otherClear).not.toHaveBeenCalled();
    });

    it('holdField and releaseField reach only the named slot player, with the field and value', () => {
      const heldOnA = vi.spyOn(playerFor(0), 'holdField');
      const releasedOnA = vi.spyOn(playerFor(0), 'releaseField');
      const heldOnB = vi.spyOn(playerFor(1), 'holdField');
      const releasedOnB = vi.spyOn(playerFor(1), 'releaseField');

      runtime.holdField('A', { name: 'filtered', voice: 1 }, 1);
      runtime.releaseField('A', { name: 'cutoff' });

      expect(heldOnA).toHaveBeenCalledExactlyOnceWith({ name: 'filtered', voice: 1 }, 1);
      expect(releasedOnA).toHaveBeenCalledExactlyOnceWith({ name: 'cutoff' });
      expect(heldOnB).not.toHaveBeenCalled();
      expect(releasedOnB).not.toHaveBeenCalled();
    });

    it("readRegisters fills the caller's buffers from the slot's player", () => {
      const spy = vi.spyOn(playerFor(0), 'readRegisters').mockImplementation((written, sent) => {
        written.fill(7);
        sent.fill(9);
      });
      const written = new Uint8Array(25);
      const sent = new Uint8Array(25);

      runtime.readRegisters('A', written, sent);

      expect(spy).toHaveBeenCalledExactlyOnceWith(written, sent);
      expect(written[24]).toBe(7);
      expect(sent[24]).toBe(9);
    });

    it('setTempo reaches the player and reads back through the snapshot', () => {
      const spy = vi.spyOn(playerFor(0), 'setTempo');

      runtime.setTempo('A', 1.25);

      expect(spy).toHaveBeenCalledExactlyOnceWith(1.25);
      expect(runtime.snapshot('A').tempo.multiplier).toBe(1.25);
      expect(runtime.snapshot('B').tempo.multiplier).toBe(1);
    });

    it('setVoiceMuted and setVoiceHeld forward the voice and flag, and read back through the snapshot', () => {
      const muted = vi.spyOn(playerFor(0), 'setVoiceMuted');
      const held = vi.spyOn(playerFor(0), 'setVoiceHeld');

      runtime.setVoiceMuted('A', 1, true);
      runtime.setVoiceHeld('A', 2, true);

      expect(muted).toHaveBeenCalledExactlyOnceWith(1, true);
      expect(held).toHaveBeenCalledExactlyOnceWith(2, true);
      expect(runtime.snapshot('A').voices).toEqual([
        { muted: false, held: false },
        { muted: true, held: false },
        { muted: false, held: true },
      ]);
    });

    it('clearVoiceMutes clears latched mutes and leaves holds', () => {
      const spy = vi.spyOn(playerFor(0), 'clearVoiceMutes');
      runtime.setVoiceMuted('A', 0, true);
      runtime.setVoiceHeld('A', 2, true);

      runtime.clearVoiceMutes('A');

      expect(spy).toHaveBeenCalledOnce();
      expect(runtime.snapshot('A').voices).toEqual([
        { muted: false, held: false },
        { muted: false, held: false },
        { muted: false, held: true },
      ]);
    });

    it('setJumpTargets declares the frames on the named slot only', () => {
      const a = vi.spyOn(playerFor(0), 'setJumpTargets');
      const b = vi.spyOn(playerFor(1), 'setJumpTargets');

      runtime.setJumpTargets('A', [10, 250]);

      expect(a).toHaveBeenCalledExactlyOnceWith([10, 250]);
      expect(b).not.toHaveBeenCalled();
    });

    it('capturePosition answers null with nothing loaded', () => {
      expect(runtime.capturePosition('A')).toBeNull();
    });

    it('capturePosition answers the frame the loaded tune is at', () => {
      runtime.load('A', playableOf(SID_MODEL_6581));

      expect(runtime.capturePosition('A')).toBe(0);
    });

    it('setActiveLoop and queueJump pass their frames to the named slot only, and null clears', () => {
      const loop = vi.spyOn(playerFor(0), 'setActiveLoop').mockImplementation(() => undefined);
      const queue = vi.spyOn(playerFor(0), 'queueJump').mockImplementation(() => undefined);
      const otherLoop = vi.spyOn(playerFor(1), 'setActiveLoop');

      runtime.setActiveLoop('A', { startFrame: 100, endFrame: 400 });
      runtime.setActiveLoop('A', null);
      runtime.queueJump('A', { startFrame: 20, endFrame: null });
      runtime.queueJump('A', null);

      expect(loop.mock.calls).toEqual([[{ startFrame: 100, endFrame: 400 }], [null]]);
      expect(queue.mock.calls).toEqual([[{ startFrame: 20, endFrame: null }], [null]]);
      expect(otherLoop).not.toHaveBeenCalled();
    });

    it('seekToFrame seeks the named slot to that frame', async () => {
      const seek = vi.spyOn(playerFor(0), 'seek').mockResolvedValue(undefined);

      await runtime.seekToFrame('A', 320);

      expect(seek).toHaveBeenCalledExactlyOnceWith(320);
    });

    it('seekToFrame hands the jump settings to the engine with the frame', async () => {
      const seek = vi.spyOn(playerFor(0), 'seek').mockResolvedValue(undefined);
      const settings = { voicePitch: [2, 1, 1], voiceMutes: [true, false, false] };

      await runtime.seekToFrame('A', 320, settings);

      expect(seek).toHaveBeenCalledExactlyOnceWith(320, settings);
    });

    it('passes a loop\'s lap phase through setActiveLoop, changeLoopAt, startShadow and queueJump', () => {
      const player = playerFor(0);
      const loop = vi.spyOn(player, 'setActiveLoop').mockImplementation(() => undefined);
      const change = vi.spyOn(player, 'changeLoopAt').mockImplementation(() => true);
      const shadow = vi.spyOn(player, 'startShadow').mockImplementation(() => true);
      const queue = vi.spyOn(player, 'queueJump').mockImplementation(() => undefined);
      const eighth = { startFrame: 39, endFrame: 42.5, lapPhase: 0.5 };

      runtime.setActiveLoop('A', { ...eighth, varispeedStart: 'wrap' });
      runtime.changeLoopAt('A', 42, { ...eighth, varispeedStart: 'wrap' });
      runtime.startShadow('A', eighth);
      runtime.startShadow('A', eighth, { frame: frames(40), held: false, lapPhase: 0 });
      runtime.queueJump('A', { ...eighth, varispeedStart: 'stop' });

      expect(loop).toHaveBeenCalledExactlyOnceWith({ ...eighth, varispeedStart: 'wrap' });
      expect(change).toHaveBeenCalledExactlyOnceWith(42, { ...eighth, varispeedStart: 'wrap' });
      expect(shadow.mock.calls).toEqual([
        [eighth],
        [eighth, { frame: 40, held: false, lapPhase: 0 }],
      ]);
      expect(queue).toHaveBeenCalledExactlyOnceWith({ ...eighth, varispeedStart: 'stop' });
    });

    it('leaves the lap phase out of a loop that has none', () => {
      const player = playerFor(0);
      const loop = vi.spyOn(player, 'setActiveLoop').mockImplementation(() => undefined);
      const shadow = vi.spyOn(player, 'startShadow').mockImplementation(() => true);

      runtime.setActiveLoop('A', { startFrame: 24, endFrame: 48 });
      runtime.startShadow('A', { startFrame: 24, endFrame: 48 });

      expect(Object.keys(loop.mock.calls[0][0] ?? {})).toEqual(['startFrame', 'endFrame']);
      expect(Object.keys(shadow.mock.calls[0][0] ?? {})).toEqual(['startFrame', 'endFrame']);
    });

    it("lands a count with its lap phase, and reads the running loop's lap phase", () => {
      const player = playerFor(0);
      const land = vi.spyOn(player, 'land').mockImplementation(() => true);
      vi.spyOn(player, 'getLapPhase').mockReturnValue(0.5);

      runtime.land('A', { frame: 39, held: true, lapPhase: 0 });
      runtime.land('A', 52);

      expect(land.mock.calls).toEqual([[{ frame: 39, held: true, lapPhase: 0 }], [52]]);
      expect(runtime.getLapPhase('A')).toBe(0.5);
      expect(runtime.getLapPhase('B')).toBeNull();
    });

    it('queueJump hands the jump settings to the engine with the target', () => {
      const queue = vi.spyOn(playerFor(0), 'queueJump').mockImplementation(() => undefined);
      const settings = { voiceMutes: [false, true, false] };

      runtime.queueJump('A', { startFrame: 20, endFrame: 80, settings });

      expect(queue.mock.calls).toEqual([[{ startFrame: 20, endFrame: 80, settings }]]);
    });

    it('throws for a slot that has not been built', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          DeckRuntime,
          { provide: FRAME_CLOCK_FACTORY, useValue: clockFactory },
          { provide: REPLAY_RUNNER_FACTORY, useValue: replayFactory },
          {
            provide: REGISTER_RECORDER_FACTORY,
            useValue: () => ({ record: () => Promise.resolve(null), dispose: () => undefined }),
          },
          { provide: MIDI_ACCESS, useValue: fakeMidiAccess(() => null) },
        ],
      });
      const unbuilt = TestBed.inject(DeckRuntime);

      expect(() => unbuilt.setTempo('A', 1)).toThrow(/has not been built/);
    });
  });
});

describe('DeckRuntime with a timing helper', () => {
  const PORT_NAME = 'TeensyROM-1234 MIDI';
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

  let runtime: DeckRuntime;
  let route: DeckSendRoute;
  let link: FakeSenderLink;
  let clocks: FakeClock[];
  let recorders: FakeRegisterRecorder[];
  let mixerPort: RecordingPort;

  function configure(supportsCancel = false): void {
    TestBed.resetTestingModule();
    createdPlayers.length = 0;
    clocks = [];
    recorders = [];
    link = new FakeSenderLink();
    mixerPort = recordingPort('port-a', { supportsCancel });
    TestBed.configureTestingModule({
      providers: [
        { provide: ASID_SENDER_LINK, useValue: link },
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
            (id) => (id === 'port-a' ? mixerPort : null),
            [{ id: 'port-a', name: PORT_NAME, manufacturer: '' }]
          ),
        },
      ],
    });
    runtime = TestBed.inject(DeckRuntime);
    route = TestBed.inject(DeckSendRoute);
  }

  /** Deck A bound, loaded and playing, with a few frames sent well ahead of real time. Returns the
   *  due time of the last of them. */
  async function playDeckA(frameCount = 3): Promise<number> {
    runtime.build('A');
    runtime.setPort('A', 'port-a');
    runtime.load('A', playableOf(SID_MODEL_6581, WRITING_TUNE));
    await runtime.play('A');
    const base = performance.now() + 5000;
    for (let i = 0; i < frameCount; i++) {
      clocks[0].tick(milliseconds(base + i * 20));
    }
    return base + (frameCount - 1) * 20;
  }

  function useSender(): void {
    route.setPath('sender');
    route.setSenderTokens(['1234']);
  }

  describe('sending', () => {
    beforeEach(() => configure());

    it('sends through the mixer port on the mixer path and through the link on the sender path', () => {
      runtime.build('A');
      runtime.setPort('A', 'port-a');

      runtime.identify('A', 'one');
      useSender();
      runtime.identify('A', 'two');

      expect(mixerPort.sent).toHaveLength(1);
      expect(link.sends.map((send) => send.token)).toEqual(['1234']);
    });

    it('drops what a sender that does not list the cartridge would get, reaching neither path', () => {
      runtime.build('A');
      runtime.setPort('A', 'port-a');
      route.setPath('sender');

      runtime.identify('A', 'dropped');

      expect(mixerPort.sent).toHaveLength(0);
      expect(link.sends).toHaveLength(0);
    });

    it('hands the link the stamp the sink gave the packet', async () => {
      useSender();
      runtime.build('A');
      runtime.setScheduleAhead('A', SENDER_SCHEDULE_AHEAD_MS);
      runtime.setPort('A', 'port-a');
      runtime.load('A', playableOf(SID_MODEL_6581, WRITING_TUNE));
      await runtime.play('A');
      const due = performance.now() + 5000;

      clocks[0].tick(milliseconds(due));

      expect(link.sends.at(-1)?.dueAtMs).toBe(due + 15);
    });

    it('reports it cannot cancel on the sender path, so the sink caps its lookahead as for any uncancellable port', async () => {
      configure(true);
      runtime.build('A');
      runtime.setPort('A', 'port-a');
      runtime.load('A', playableOf(SID_MODEL_6581, WRITING_TUNE));
      await runtime.play('A');
      const due = performance.now() + 5000;

      runtime.setScheduleAhead('A', milliseconds(100));
      clocks[0].tick(milliseconds(due));
      expect(mixerPort.stamps.at(-1)).toBe(due + 100);

      useSender();
      runtime.setScheduleAhead('A', milliseconds(100));
      clocks[0].tick(milliseconds(due + 20));
      expect(link.sends.at(-1)?.dueAtMs).toBe(due + 20 + 40);
    });

    it('cancels nothing on the sender path, whatever the mixer port can do', () => {
      configure(true);
      runtime.build('A');
      runtime.setPort('A', 'port-a');
      const cancel = vi.spyOn(mixerPort, 'cancelPending');
      useSender();

      runtime.seekToFrame('A', 0);

      expect(cancel).not.toHaveBeenCalled();
    });

    it('keeps due times from decreasing across play, pause and stop at the sender lookahead', async () => {
      useSender();
      runtime.build('A');
      runtime.setScheduleAhead('A', SENDER_SCHEDULE_AHEAD_MS);
      await playDeckA();

      runtime.pause('A');
      await runtime.play('A');
      runtime.stop('A');

      const dues = link.sends.map((send) => send.dueAtMs);
      const afterFirstFrame = dues.slice(dues.findIndex((due) => due !== undefined));
      expect(afterFirstFrame.length).toBeGreaterThan(3);
      expect(afterFirstFrame.every((due) => due !== undefined)).toBe(true);
      expect(afterFirstFrame).toEqual([...afterFirstFrame].sort((a, b) => (a ?? 0) - (b ?? 0)));
    });
  });

  describe('the bench probes', () => {
    interface BenchReading {
      decks: {
        A: {
          scheduleAheadMs: number;
          frames: number;
          presses: {
            byKind: Record<string, { count: number }>;
            noFrame: number;
            superseded: number;
          };
        };
      };
    }
    interface BenchHandle {
      report(): BenchReading;
      reset(): void;
      lagTimeline(): Record<string, { atS: number; frames: number }[]>;
    }
    const bench = (): BenchHandle => (globalThis as unknown as { djBench: BenchHandle }).djBench;
    const reading = (): BenchReading => bench().report();

    beforeEach(() => {
      configure();
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** Marks `kind` on deck A, then lets the clock send one frame stamped near now. */
    function pressThenFrame(kind: Parameters<DeckRuntime['markPress']>[1]): void {
      runtime.markPress('A', kind);
      clocks[0].tick(milliseconds(performance.now()));
    }

    it('lands one reading when a mark is followed by a stamped register frame', async () => {
      await playDeckA();

      pressThenFrame('mute');

      const { byKind } = reading().decks.A.presses;
      expect(byKind['mute'].count).toBe(1);
    });

    it('measures a nudge only from the frame after the engine took it', async () => {
      await playDeckA();

      runtime.markPress('A', 'nudge');
      clocks[0].tick(milliseconds(performance.now()));
      expect(reading().decks.A.presses.byKind['nudge']).toBeUndefined();

      runtime.notePressApplied('A');
      clocks[0].tick(milliseconds(performance.now()));
      expect(reading().decks.A.presses.byKind['nudge'].count).toBe(1);
    });

    it('does nothing for a slot that is not built', () => {
      runtime.build('A');

      expect(() => {
        runtime.markPress('B', 'play');
        runtime.notePressApplied('B');
      }).not.toThrow();
    });

    it('sends the same bytes with the same stamps whether or not a press is being measured', async () => {
      vi.spyOn(performance, 'now').mockReturnValue(50_000);
      const run = async (press: boolean): Promise<{ sent: Uint8Array[]; stamps: (number | undefined)[] }> => {
        configure();
        runtime.build('A');
        runtime.setPort('A', 'port-a');
        runtime.load('A', playableOf(SID_MODEL_6581, WRITING_TUNE));
        await runtime.play('A');
        if (press) {
          runtime.markPress('A', 'tempo');
        }
        for (let i = 0; i < 3; i++) {
          clocks[0].tick(milliseconds(50_000 + i * 20));
        }
        return { sent: [...mixerPort.sent], stamps: [...mixerPort.stamps] };
      };

      const without = await run(false);
      const withPress = await run(true);

      expect(without.sent.length).toBeGreaterThan(2);
      expect(withPress).toEqual(without);
    });

    it('clears the press readings and a pending mark with the handle reset', async () => {
      await playDeckA();
      pressThenFrame('mute');
      expect(reading().decks.A.presses.byKind['mute'].count).toBe(1);
      runtime.markPress('A', 'tempo');

      bench().reset();

      expect(reading().decks).not.toHaveProperty('A');
      clocks[0].tick(milliseconds(performance.now()));
      const { byKind, noFrame, superseded } = reading().decks.A.presses;
      expect(byKind).toEqual({});
      expect(noFrame).toBe(0);
      expect(superseded).toBe(0);
    });

    it('gives the lag timeline per built deck, one row for each closed 10 s', async () => {
      let nowMs = 50_000;
      vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
      await playDeckA();
      runtime.build('B');
      bench().reset();

      clocks[0].tick(milliseconds(nowMs));
      nowMs += 10_500;
      clocks[0].tick(milliseconds(nowMs));

      const timeline = bench().lagTimeline();
      expect(Object.keys(timeline).sort()).toEqual(['A', 'B']);
      expect(timeline.A).toEqual([expect.objectContaining({ atS: 10, frames: 1 })]);
      expect(timeline.B).toEqual([]);
    });

    it('keeps what the delivery probe has recorded when the schedule-ahead changes', async () => {
      await playDeckA();
      const before = reading().decks.A;

      runtime.setScheduleAhead('A', milliseconds(7));

      const after = reading().decks.A;
      expect(after.frames).toBe(before.frames);
      expect(after.scheduleAheadMs).toBe(7);
      expect(before.scheduleAheadMs).not.toBe(7);
    });
  });

  describe('the cartridge token', () => {
    beforeEach(() => configure());

    it('comes from the bound port name, and is gone with the port', () => {
      runtime.build('A');

      runtime.setPort('A', 'port-a');
      expect(runtime.deviceToken('A')).toBe('1234');

      runtime.setPort('A', null);
      expect(runtime.deviceToken('A')).toBeNull();
    });

    it('is null for a port the access does not enumerate, and for a slot not built', () => {
      runtime.build('A');

      runtime.setPort('A', 'port-unknown');

      expect(runtime.deviceToken('A')).toBeNull();
      expect(runtime.deviceToken('B')).toBeNull();
    });
  });

  describe('a slot that is not built', () => {
    beforeEach(() => configure());

    it('is passed over by the calls the supervisor and the bench make for every slot', () => {
      expect(() => {
        runtime.setScheduleAhead('B', milliseconds(15));
        runtime.sendRegisterImage('B');
      }).not.toThrow();
      expect(runtime.isPlaying('B')).toBe(false);
    });
  });

  describe('isPlaying', () => {
    beforeEach(() => configure());

    it('is true for a playing deck and false for a stopped or paused one', async () => {
      runtime.build('A');
      runtime.load('A', playableOf(SID_MODEL_6581));
      expect(runtime.isPlaying('A')).toBe(false);

      await runtime.play('A');
      expect(runtime.isPlaying('A')).toBe(true);

      runtime.pause('A');
      expect(runtime.isPlaying('A')).toBe(false);
    });

    it('is true for a paused deck the hand is running, which still sends frames', async () => {
      runtime.build('A');
      runtime.load('A', playableOf(SID_MODEL_6581));
      recorders[0].answer(0, recordOf(500));
      await settle();
      await runtime.play('A');
      runtime.pause('A');

      expect(runtime.enterVarispeed('A', () => 1)).toBe(true);

      expect(runtime.snapshot('A').transport).toBe('paused');
      expect(runtime.isPlaying('A')).toBe(true);
    });
  });

  describe('the register image', () => {
    const IMAGE_LENGTH = 12 + 25;

    beforeEach(() => configure());

    it('is one unstamped packet carrying all 25 registers on the sender path, with frames stamped ahead', async () => {
      useSender();
      runtime.build('A');
      runtime.setScheduleAhead('A', SENDER_SCHEDULE_AHEAD_MS);
      await playDeckA();

      runtime.sendRegisterImage('A');

      const image = link.sends.at(-1);
      expect(image?.bytes).toHaveLength(IMAGE_LENGTH);
      expect(image?.dueAtMs).toBeUndefined();
    });

    it('is unstamped on the mixer path too, where an uncancellable port would stamp it behind the last frame', async () => {
      runtime.build('A');
      runtime.setScheduleAhead('A', SENDER_SCHEDULE_AHEAD_MS);
      const lastDue = await playDeckA();

      runtime.sendRegisterImage('A');

      expect(lastDue + 15).toBeGreaterThan(performance.now());
      expect(mixerPort.sent.at(-1)).toHaveLength(IMAGE_LENGTH);
      expect(mixerPort.stamps.at(-1)).toBeUndefined();
    });

    it('leaves the next frame stamped as usual', async () => {
      runtime.build('A');
      const lastDue = await playDeckA();
      runtime.sendRegisterImage('A');

      clocks[0].tick(milliseconds(lastDue + 20));

      expect(mixerPort.stamps.at(-1)).toBe(lastDue + 20);
    });

    it('is not sent for a deck that is not playing', () => {
      runtime.build('A');
      runtime.setPort('A', 'port-a');
      runtime.load('A', playableOf(SID_MODEL_6581));

      runtime.sendRegisterImage('A');

      expect(mixerPort.sent).toHaveLength(0);
    });
  });
});
