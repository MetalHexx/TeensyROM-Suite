import { describe, it, expect, afterEach, vi } from 'vitest';
import { microseconds } from '@sidablist/core';
import type { IAsidSenderLink, SenderWakeAlarm } from '@teensyrom-nx/application';
import { DeckTickClock, WAKE_EPSILON_MS } from './deck-tick-clock';

const BUFFER_FRAMES = 256;
const SAMPLE_RATE = 48000;
const BUFFER_DURATION_US = (BUFFER_FRAMES / SAMPLE_RATE) * 1_000_000;

/**
 * Stands in for the browser's Web Audio graph, which jsdom does not implement. It exposes the same
 * three collaborators the clock touches — a context, a `ScriptProcessorNode` whose callback the test
 * fires by hand, and a gain node — and records the connections so the "reaches the destination"
 * requirement can be checked.
 */
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  // Consumed once per instance construction — set it immediately before the `start()` call whose
  // context should get this instance's `resume()` behaviour, so a test can hold that one call's
  // `resume()` open (or reject it) while every other instance in the same test resolves normally.
  static nextResume: (() => Promise<void>) | null = null;

  readonly sampleRate = SAMPLE_RATE;
  readonly destination = { id: 'destination' };
  readonly connections: [string, string][] = [];
  node: FakeScriptProcessorNode | null = null;
  gain: FakeGainNode | null = null;
  resumed = false;
  closed = false;
  private readonly resumeImpl: () => Promise<void>;

  constructor() {
    FakeAudioContext.instances.push(this);
    this.resumeImpl = FakeAudioContext.nextResume ?? (() => Promise.resolve());
    FakeAudioContext.nextResume = null;
  }

  resume(): Promise<void> {
    this.resumed = true;
    return this.resumeImpl();
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  createScriptProcessor(): FakeScriptProcessorNode {
    this.node = new FakeScriptProcessorNode(this);
    return this.node;
  }

  createGain(): FakeGainNode {
    this.gain = new FakeGainNode(this);
    return this.gain;
  }
}

class FakeScriptProcessorNode {
  onaudioprocess: (() => void) | null = null;
  disconnected = false;

  constructor(private readonly context: FakeAudioContext) {}

  connect(target: unknown): void {
    this.context.connections.push(['node', describeTarget(target)]);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  /** Fires one audio buffer boundary, the way the browser's audio thread would. */
  fireBuffers(count: number): void {
    for (let i = 0; i < count; i++) {
      this.onaudioprocess?.();
    }
  }
}

class FakeGainNode {
  readonly gain = { value: 1 };

  constructor(private readonly context: FakeAudioContext) {}

  connect(target: unknown): void {
    this.context.connections.push(['gain', describeTarget(target)]);
  }

  disconnect(): void {
    // nothing to track: the node's own teardown is what the clock is responsible for
  }
}

function describeTarget(target: unknown): string {
  if (target instanceof FakeGainNode) {
    return 'gain';
  }
  return (target as { id?: string }).id === 'destination' ? 'destination' : 'unknown';
}

function installFakeAudioContext(): void {
  FakeAudioContext.instances = [];
  FakeAudioContext.nextResume = null;
  vi.stubGlobal('AudioContext', FakeAudioContext);
}

/** A deferred `resume()`, so a test can decide exactly when one `AudioContext`'s `resume()`
 *  settles instead of it resolving in the same microtask it was created in. */
function deferredResume(): { settle: () => void; fail: (error: unknown) => void } {
  let settle!: () => void;
  let fail!: (error: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  FakeAudioContext.nextResume = () => promise;
  return { settle, fail };
}

async function startedClock(
  intervalUs: number,
  onFrame: (dueAtMs: number, catchUpClamped: boolean) => void
) {
  installFakeAudioContext();
  const clock = new DeckTickClock(null);
  await clock.start(microseconds(intervalUs), onFrame);
  const context = FakeAudioContext.instances[0];
  const node = context.node;
  if (node === null) {
    throw new Error('the clock did not create a script processor node');
  }
  return { clock, context, node };
}

/**
 * Drives `performance.now()` by hand, so a callback gap is whatever the test says it is rather than
 * however long the test itself happened to take.
 */
function installFakeNow(): (advanceMs: number) => void {
  let nowMs = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  return (advanceMs: number) => {
    nowMs += advanceMs;
  };
}

/** Fires `count` callbacks `gapMs` apart on the faked clock. */
function fireEvenly(
  node: FakeScriptProcessorNode,
  advance: (ms: number) => void,
  count: number,
  gapMs: number
): void {
  for (let i = 0; i < count; i++) {
    advance(gapMs);
    node.fireBuffers(1);
  }
}

/**
 * Fires `count` callbacks at the nominal buffer spacing — the even, healthy case.
 *
 * The clock credits measured elapsed time rather than the buffer duration the sample rate implies,
 * so real time has to pass for a frame to fall due; firing buffers back to back advances nothing.
 */
function fireNominal(
  node: FakeScriptProcessorNode,
  advance: (ms: number) => void,
  count: number
): void {
  fireEvenly(node, advance, count, BUFFER_DURATION_US / 1000);
}

describe('DeckTickClock on the audio source', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('jitter', () => {
    it('reports no scatter when every callback lands the same distance apart', async () => {
      const advance = installFakeNow();
      const { clock, node } = await startedClock(20000, () => undefined);

      fireEvenly(node, advance, 10, 5);

      expect(clock.stats.jitterMs).toBeCloseTo(0);
      expect(clock.stats.worstGapMs).toBeCloseTo(5);
    });

    it('catches a lone stall in the worst gap that barely moves the deviation', async () => {
      const advance = installFakeNow();
      const { clock, node } = await startedClock(20000, () => undefined);

      fireEvenly(node, advance, 50, 5);
      const evenJitter = clock.stats.jitterMs;

      advance(200); // one main-thread stall: no callback, so no packet goes out
      node.fireBuffers(1);
      fireEvenly(node, advance, 50, 5);

      // The point of carrying both figures — σ stays small enough to look healthy while the gap that
      // would empty any cartridge buffer is plainly visible.
      expect(clock.stats.worstGapMs).toBeCloseTo(200);
      expect(clock.stats.jitterMs).toBeGreaterThan(evenJitter);
      expect(clock.stats.jitterMs).toBeLessThan(25);
    });

    it('excludes the first gap, which spans resume() rather than the running clock', async () => {
      const advance = installFakeNow();
      const { clock, node } = await startedClock(20000, () => undefined);

      advance(500); // the audio graph coming up — a one-off cost, not the clock's behaviour
      node.fireBuffers(1);
      fireEvenly(node, advance, 10, 5);

      expect(clock.stats.worstGapMs).toBeCloseTo(5);
      expect(clock.stats.jitterMs).toBeCloseTo(0);
    });

    it('reports zeroes rather than dividing by zero before two callbacks have landed', async () => {
      const advance = installFakeNow();
      const { clock, node } = await startedClock(20000, () => undefined);

      advance(5);
      node.fireBuffers(1);

      expect(clock.stats.jitterMs).toBe(0);
      expect(clock.stats.worstGapMs).toBe(0);
    });

    it('starts a restarted clock over rather than carrying the old scatter forward', async () => {
      const advance = installFakeNow();
      const { clock, node } = await startedClock(20000, () => undefined);
      fireEvenly(node, advance, 5, 5);
      advance(300);
      node.fireBuffers(1);
      expect(clock.stats.worstGapMs).toBeCloseTo(300);

      const restarted = await startedClock(20000, () => undefined);
      fireEvenly(restarted.node, advance, 10, 5);

      expect(restarted.clock.stats.worstGapMs).toBeCloseTo(5);
    });
  });

  describe('advancing on measured time', () => {
    it('emits frames against the wall clock, not against the buffer duration the sample rate implies', async () => {
      const advance = installFakeNow();
      let frames = 0;
      const { node } = await startedClock(20000, () => frames++);

      // 100 callbacks 10 ms apart is very nearly a second of real time, which owes 49 frames at a
      // 20 ms interval. Crediting the nominal 5.33 ms buffer instead would account for only ~0.53 s
      // and emit 26 — the gap between those two numbers is the whole point of the change.
      fireEvenly(node, advance, 100, 10);

      expect(frames).toBe(49);
    });

    it('holds drift bounded rather than letting it accumulate with runtime', async () => {
      const advance = installFakeNow();
      const { clock, node } = await startedClock(20000, () => undefined);

      fireEvenly(node, advance, 100, 10);
      const early = Math.abs(clock.stats.driftMs);
      fireEvenly(node, advance, 400, 10);
      const late = Math.abs(clock.stats.driftMs);

      // Bounded by the frame still accumulating plus the first callback's assumed buffer, and — the
      // part that matters — no larger after five times the runtime. A clock advancing on assumed
      // time drifts by a fixed fraction of elapsed time instead, which grows without limit and is
      // what leaves the cartridge's re-timer hunting.
      const boundMs = 20 + BUFFER_DURATION_US / 1000;
      expect(early).toBeLessThan(boundMs);
      expect(late).toBeLessThan(boundMs);
    });

    it('makes up the frames a stall owed rather than leaving the stream short', async () => {
      const advance = installFakeNow();
      let frames = 0;
      const { node } = await startedClock(10000, () => frames++);

      fireEvenly(node, advance, 3, 5);
      expect(frames).toBe(1);

      // 40 ms with no callback: the cartridge drains straight through it, so the four frames that
      // fell due have to arrive rather than be skipped, or its queue stays that much shallower.
      advance(40);
      node.fireBuffers(1);

      expect(frames).toBe(5);
    });

    it('caps catch-up so a very long stall cannot flood the cartridge queue', async () => {
      const advance = installFakeNow();
      let frames = 0;
      const { node } = await startedClock(10000, () => frames++);

      fireEvenly(node, advance, 2, 5);
      const before = frames;

      advance(5000); // five seconds: past the point the cartridge re-buffered on its own
      node.fireBuffers(1);

      // 250 ms of catch-up at a 10 ms interval, not five seconds' worth.
      expect(frames - before).toBe(25);
    });

    it('counts callbacks arriving more than twice the buffer duration apart', async () => {
      const advance = installFakeNow();
      const { clock, node } = await startedClock(20000, () => undefined);

      fireEvenly(node, advance, 20, 5); // inside the ~10.7 ms threshold
      expect(clock.stats.lateCallbacks).toBe(0);

      advance(40);
      node.fireBuffers(1);
      advance(40);
      node.fireBuffers(1);

      // Separates one spike from a recurring one, which the running-maximum worst gap cannot.
      expect(clock.stats.lateCallbacks).toBe(2);
      expect(clock.stats.worstGapMs).toBeCloseTo(40);
    });
  });

  describe('due times', () => {
    it('places a frame inside the span the callback that released it credited', async () => {
      const advance = installFakeNow();
      const dueTimes: number[] = [];
      const { node } = await startedClock(20000, (dueAtMs) => dueTimes.push(dueAtMs));

      fireEvenly(node, advance, 3, 10);

      // The frame fell due during the third callback's 10 ms span, not at the instant that callback
      // got around to releasing it — which is the whole difference this carries to the transport.
      expect(dueTimes).toHaveLength(1);
      expect(dueTimes[0]).toBeGreaterThan(20);
      expect(dueTimes[0]).toBeLessThan(30);
    });

    it('releases a burst from one callback at times one interval apart, all already past', async () => {
      const advance = installFakeNow();
      const dueTimes: number[] = [];
      const { node } = await startedClock(10000, (dueAtMs) => dueTimes.push(dueAtMs));

      fireEvenly(node, advance, 1, 5);
      advance(45); // one gap wide enough to owe several frames at once
      node.fireBuffers(1);

      expect(dueTimes).toHaveLength(5);
      const spacings = dueTimes.slice(1).map((due, i) => due - dueTimes[i]);
      spacings.forEach((spacing) => expect(spacing).toBeCloseTo(10));
      // In the past, so the transport treats them as "send now" until a schedule-ahead is dialled
      // in — and inside the gap they were owed for, never before it.
      expect(dueTimes[0]).toBeGreaterThan(5);
      expect(dueTimes[dueTimes.length - 1]).toBeLessThanOrEqual(50);
    });

    it('tracks measured time over a long run rather than walking away from it', async () => {
      const advance = installFakeNow();
      const dueTimes: number[] = [];
      const { node } = await startedClock(20000, (dueAtMs) => dueTimes.push(dueAtMs));

      fireEvenly(node, advance, 500, 10); // ~5 s of measured time

      // Anchoring on the nominal grid instead would drift by the difference between the interval
      // and the rate frames actually come due at; re-anchoring every callback holds each due time
      // within one interval of the callback that released it, however long the run.
      const lastCallbackMs = 5000;
      expect(dueTimes[dueTimes.length - 1]).toBeGreaterThan(lastCallbackMs - 20);
      expect(dueTimes[dueTimes.length - 1]).toBeLessThanOrEqual(lastCallbackMs);
    });

    it('flags the frames a clamped catch-up releases, and only those', async () => {
      const advance = installFakeNow();
      const flags: boolean[] = [];
      const { node } = await startedClock(10000, (dueAtMs, catchUpClamped) =>
        flags.push(catchUpClamped)
      );

      fireEvenly(node, advance, 3, 10);
      const healthy = flags.length;
      expect(flags.every((flagged) => !flagged)).toBe(true);

      // Five seconds: the advance credits only its 250 ms cap, so every frame it releases is
      // anchored later than it truly fell due and any lag read off it under-reports.
      advance(5000);
      node.fireBuffers(1);
      const burst = flags.slice(healthy);

      expect(burst).toHaveLength(25);
      expect(burst.every((flagged) => flagged)).toBe(true);

      advance(10);
      node.fireBuffers(1);

      // The next healthy callback is trustworthy again — the flag describes the advance, not the run.
      expect(flags[flags.length - 1]).toBe(false);
    });
  });

  it('routes the processor through a silenced gain node into the destination', async () => {
    const { context } = await startedClock(20000, () => undefined);

    expect(context.resumed).toBe(true);
    expect(context.gain?.gain.value).toBe(0);
    expect(context.connections).toEqual([
      ['node', 'gain'],
      ['gain', 'destination'],
    ]);
  });

  it('emits a frame once the audio callbacks have covered the interval', async () => {
    const advance = installFakeNow();
    let frames = 0;
    const { clock, node } = await startedClock(20000, () => frames++);

    // Four 256-frame buffers at 48 kHz is 21.3 ms — one 20 ms frame's worth.
    fireNominal(node, advance, 4);

    expect(frames).toBe(1);
    expect(clock.stats.framesEmitted).toBe(1);
    expect(clock.stats.nominalIntervalUs).toBe(20000);
  });

  it('emits several frames from a single callback at short intervals', async () => {
    let frames = 0;
    const { node } = await startedClock(1000, () => frames++);

    node.fireBuffers(1);

    expect(frames).toBe(Math.floor(BUFFER_DURATION_US / 1000));
  });

  it('retimes a running clock without dropping the frames already counted', async () => {
    const advance = installFakeNow();
    let frames = 0;
    const { clock, node } = await startedClock(20000, () => frames++);

    fireNominal(node, advance, 4);
    clock.setIntervalUs(microseconds(10000));
    fireNominal(node, advance, 2);

    expect(clock.stats.nominalIntervalUs).toBe(10000);
    expect(frames).toBe(2);
  });

  it('detaches the callback and closes the context on stop, keeping the stats readable', async () => {
    const advance = installFakeNow();
    let frames = 0;
    const { clock, context, node } = await startedClock(20000, () => frames++);
    fireNominal(node, advance, 4);

    clock.stop();
    fireNominal(node, advance, 8);

    expect(node.onaudioprocess).toBeNull();
    expect(node.disconnected).toBe(true);
    expect(context.closed).toBe(true);
    expect(frames).toBe(1);
    expect(clock.stats.framesEmitted).toBe(1);
  });

  describe('a pending start() superseded before resume() settles', () => {
    it('closes the context and never publishes a graph when stop() runs first', async () => {
      installFakeAudioContext();
      const resume = deferredResume();
      const clock = new DeckTickClock(null);

      const startPromise = clock.start(microseconds(20000), () => undefined);
      const context = FakeAudioContext.instances[0];
      clock.stop();
      resume.settle();
      await startPromise;

      expect(context.closed).toBe(true);
      // The graph is built after the token check, so a superseded start() never reaches it.
      expect(context.node).toBeNull();
      expect(context.connections).toEqual([]);
      expect(clock.stats.framesEmitted).toBe(0);
    });

    it('closes the stale context and wires up only the later start() when it runs before resume() settles', async () => {
      installFakeAudioContext();
      const firstResume = deferredResume();
      const clock = new DeckTickClock(null);

      const firstStart = clock.start(microseconds(20000), () => undefined);
      const staleContext = FakeAudioContext.instances[0];

      // The superseding start() resolves immediately (the default fake resume()).
      const secondStart = clock.start(microseconds(10000), () => undefined);
      const liveContext = FakeAudioContext.instances[1];
      await secondStart;

      firstResume.settle();
      await firstStart;

      expect(staleContext.closed).toBe(true);
      expect(staleContext.node).toBeNull();
      expect(liveContext.closed).toBe(false);
      expect(liveContext.node).not.toBeNull();
      expect(clock.stats.nominalIntervalUs).toBe(10000);
    });

    it('closes the context when resume() itself rejects', async () => {
      installFakeAudioContext();
      const resume = deferredResume();
      const clock = new DeckTickClock(null);

      const startPromise = clock.start(microseconds(20000), () => undefined);
      const context = FakeAudioContext.instances[0];
      const failure = new Error('resume denied');
      resume.fail(failure);

      await expect(startPromise).rejects.toThrow('resume denied');
      expect(context.closed).toBe(true);
    });
  });
});

/** One armed wake, with the sender's side played by the test: `wake` is the sender's message
 *  arriving, `beat` the link's steady ticker. */
class FakeAlarm implements SenderWakeAlarm {
  readonly arms: number[] = [];
  cancels = 0;

  constructor(
    private readonly onWake: (askedAtMs: number, sentAtMs: number, nowMs: number) => void,
    private readonly onBeat: (nowMs: number) => void,
    private readonly events: string[]
  ) {}

  get armedAt(): number {
    return this.arms[this.arms.length - 1];
  }

  arm(atMs: number): void {
    this.arms.push(atMs);
    this.events.push('arm');
  }

  cancel(): void {
    this.cancels++;
  }

  wake(askedAtMs: number, sentAtMs = askedAtMs, nowMs = sentAtMs): void {
    this.onWake(askedAtMs, sentAtMs, nowMs);
  }

  beat(nowMs: number): void {
    this.onBeat(nowMs);
  }
}

class FakeLink implements IAsidSenderLink {
  readonly alarms: FakeAlarm[] = [];
  readonly events: string[] = [];

  wakeAlarm(
    onWake: (askedAtMs: number, sentAtMs: number, nowMs: number) => void,
    onBeat: (nowMs: number) => void
  ): SenderWakeAlarm {
    const alarm = new FakeAlarm(onWake, onBeat, this.events);
    this.alarms.push(alarm);
    return alarm;
  }

  senderUrl(): string | null {
    return null;
  }
  start(): void {
    // the clock never starts the link
  }
  open(): void {
    // the clock never opens the link
  }
  close(): void {
    // the clock never closes the link
  }
  send(): void {
    // the clock sends no packets
  }
  selfTest(): Promise<'aborted'> {
    return Promise.resolve('aborted');
  }
  readTiming(): Promise<null> {
    return Promise.resolve(null);
  }
  clearTiming(): void {
    // the clock reads no timing
  }
}

interface SenderRig {
  readonly clock: DeckTickClock;
  readonly link: FakeLink;
  readonly alarm: FakeAlarm;
  /** Every frame the clock released: its due time and whether the catch-up was clamped. */
  readonly dues: number[];
  readonly clamped: boolean[];
  /** Moves the faked `performance.now()` to `ms`. */
  to(ms: number): void;
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

/** A clock on the sender source, started at 0 ms with `intervalUs`, against a fake link. */
async function senderRig(
  options: { intervalUs?: number; throwOnFirstFrame?: boolean } = {}
): Promise<SenderRig> {
  const { intervalUs = 10_000, throwOnFirstFrame = false } = options;
  const advance = installFakeNow();
  installFakeAudioContext();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const link = new FakeLink();
  const clock = new DeckTickClock(link);
  const dues: number[] = [];
  const clamped: boolean[] = [];
  let thrown = false;
  clock.setSource('sender');
  await clock.start(microseconds(intervalUs), (dueAtMs, catchUpClamped) => {
    link.events.push('frame');
    dues.push(dueAtMs);
    clamped.push(catchUpClamped);
    if (throwOnFirstFrame && !thrown) {
      thrown = true;
      throw new Error('render failed');
    }
  });
  let at = 0;
  return {
    clock,
    link,
    alarm: link.alarms[0],
    dues,
    clamped,
    to: (ms) => {
      advance(ms - at);
      at = ms;
    },
  };
}

describe('DeckTickClock on the sender source', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('asks for the first wake at once, one interval and ε out, and asks for none while stopped', async () => {
    const { clock, link, alarm } = await senderRig();

    expect(alarm.arms).toEqual([10 + WAKE_EPSILON_MS]);

    clock.stop();
    alarm.beat(5000);
    alarm.wake(10 + WAKE_EPSILON_MS);

    expect(alarm.arms).toHaveLength(1);
    expect(alarm.cancels).toBe(1);

    const idle = new DeckTickClock(link);
    idle.setSource('sender');
    expect(link.alarms).toHaveLength(1);
  });

  describe('a wake', () => {
    it('asks for the next one before it renders', async () => {
      const { alarm, link, dues } = await senderRig();

      alarm.wake(10.3, 10.35, 10.4);

      expect(link.events).toEqual(['arm', 'arm', 'frame']);
      expect(dues).toHaveLength(1);
      expect(dues[0]).toBeCloseTo(10, 6);
    });

    it('asks before it renders also when the render throws, and the chain goes on', async () => {
      const { alarm, link, clock } = await senderRig({ throwOnFirstFrame: true });

      expect(() => alarm.wake(10.3, 10.3, 10.4)).toThrow('render failed');
      expect(link.events).toEqual(['arm', 'arm', 'frame']);
      expect(alarm.armedAt).toBeCloseTo(20.3, 6);

      alarm.wake(20.3, 20.3, 20.4);

      expect(clock.wakeReadings().wakes).toBe(2);
      expect(alarm.armedAt).toBeCloseTo(30.3, 6);
    });

    it('asks for the last due plus the interval plus ε, stepped whole intervals past now after a stall', async () => {
      const { alarm, dues } = await senderRig();

      alarm.wake(10.3);
      expect(alarm.armedAt).toBeCloseTo(20.3, 6);
      alarm.wake(20.3);
      expect(alarm.armedAt).toBeCloseTo(30.3, 6);

      alarm.wake(30.3, 30.3, 100.3); // 70 ms late

      expect(alarm.armedAt).toBeCloseTo(110.3, 6);
      expect(dues).toHaveLength(10);
      expect(dues[dues.length - 1]).toBeCloseTo(100, 6);
    });

    it('renders nothing when it finds no frame due, and asks again for the same time', async () => {
      const { alarm, clock, dues } = await senderRig();

      alarm.wake(10.3, 10.3, 9.5);

      expect(dues).toHaveLength(0);
      expect(alarm.arms).toEqual([10.3, 10.3]);
      expect(clock.wakeReadings().early).toBe(1);
    });

    it('catches up a 400 ms stall under the cap, flagging every frame it releases and only those', async () => {
      const { alarm, dues, clamped } = await senderRig();
      alarm.wake(10.3);

      alarm.wake(20.3, 20.3, 420.3);

      expect(dues.length - 1).toBe(25);
      expect(clamped.slice(1).every((flagged) => flagged)).toBe(true);
      expect(clamped[0]).toBe(false);

      alarm.wake(alarm.armedAt, alarm.armedAt, alarm.armedAt);

      expect(clamped[clamped.length - 1]).toBe(false);
    });

    it('records the sender lateness and the mixer lateness apart, and clears them on reset', async () => {
      const { alarm, clock } = await senderRig();

      alarm.wake(10.3, 10.5, 10.9);

      const { senderLateMs, mixerLateMs, wakes } = clock.wakeReadings();
      expect(wakes).toBe(1);
      expect([senderLateMs.count, mixerLateMs.count]).toEqual([1, 1]);
      expect(senderLateMs.max).toBeCloseTo(0.2, 2);
      expect(mixerLateMs.max).toBeCloseTo(0.4, 2);

      clock.resetWakeReadings();

      expect(clock.wakeReadings()).toMatchObject({ wakes: 0, senderLateMs: { count: 0 } });
    });

    it('counts the gap between handled wakes, and a wake handled over an interval past its due as late', async () => {
      const { alarm, clock } = await senderRig();

      alarm.wake(10.3, 10.3, 10.4);
      alarm.wake(20.3, 20.3, 20.4);
      expect(clock.stats.worstGapMs).toBeCloseTo(10, 6);
      expect(clock.stats.lateCallbacks).toBe(0);

      alarm.wake(30.3, 30.3, 45);

      expect(clock.stats.worstGapMs).toBeCloseTo(24.6, 6);
      expect(clock.stats.lateCallbacks).toBe(1);
    });
  });

  describe('a speed change', () => {
    it('re-arms at once for the next due at the new interval, replacing the armed wake', async () => {
      const { alarm, clock } = await senderRig();

      clock.setIntervalUs(microseconds(20_000));

      expect(alarm.arms).toEqual([10.3, 20.3]);
      expect(clock.stats.nominalIntervalUs).toBe(20_000);
    });

    it('arms a speed-up whose new due has passed for that past time, and ignores the wake it overtook', async () => {
      const { alarm, clock, to, dues } = await senderRig();
      alarm.wake(10.3, 10.3, 10.3);
      const overtaken = alarm.armedAt;
      to(15);

      clock.setIntervalUs(microseconds(2000));

      expect(alarm.armedAt).toBeCloseTo(12.3, 6);
      const armsBefore = alarm.arms.length;
      alarm.wake(overtaken, overtaken, 20.3);
      expect(alarm.arms).toHaveLength(armsBefore);
      expect(dues).toHaveLength(1);

      alarm.wake(12.3, 12.4, 15);

      expect(dues.slice(1).map((due) => Math.round(due))).toEqual([12, 14]);
      expect(alarm.armedAt).toBeCloseTo(16.3, 6);
    });
  });

  describe('the guard', () => {
    it('renders the frames that fell due and asks again on every silent beat, logging once per stretch', async () => {
      const { alarm, clock, dues } = await senderRig();
      const warn = vi.mocked(console.warn);

      alarm.beat(50);
      expect(clock.wakeReadings().guardRearms).toBe(0);
      expect(dues).toHaveLength(0);

      alarm.beat(250);
      alarm.beat(500);

      expect(clock.wakeReadings().guardRearms).toBe(2);
      expect(dues).toHaveLength(50);
      expect(alarm.armedAt).toBeCloseTo(510.3, 6);
      expect(warn).toHaveBeenCalledTimes(1);

      alarm.wake(alarm.armedAt, alarm.armedAt, 510.5);
      alarm.beat(760);

      expect(clock.wakeReadings().guardRearms).toBe(3);
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('asks again for the frame after the last one released, not stepped past now, when the render throws', async () => {
      const { alarm } = await senderRig({ throwOnFirstFrame: true });

      expect(() => alarm.beat(250)).toThrow('render failed');

      expect(alarm.armedAt).toBeCloseTo(20.3, 6);
    });

    it('does not take the beat right after a play or a switch to the sender for a broken chain', async () => {
      installFakeAudioContext();
      const advance = installFakeNow();
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const link = new FakeLink();
      const clock = new DeckTickClock(link);
      clock.setSource('sender');
      advance(5000);

      await clock.start(microseconds(10_000), () => undefined);
      link.alarms[0].beat(5050);

      expect(clock.wakeReadings().guardRearms).toBe(0);

      clock.setSource('audio');
      await settle();
      advance(5000);
      clock.setSource('sender');
      link.alarms[0].beat(10_050);

      expect(clock.wakeReadings().guardRearms).toBe(0);
    });
  });

  describe('a stale wake', () => {
    it('is ignored after a stop', async () => {
      const { alarm, clock, dues } = await senderRig();
      const asked = alarm.armedAt;

      clock.stop();
      alarm.wake(asked);

      expect(dues).toHaveLength(0);
      expect(alarm.arms).toHaveLength(1);
      expect(clock.wakeReadings().wakes).toBe(0);
    });

    it('is ignored after a switch to the audio source', async () => {
      const { alarm, clock, dues } = await senderRig();
      const asked = alarm.armedAt;

      clock.setSource('audio');
      alarm.wake(asked);

      expect(dues).toHaveLength(0);
      expect(alarm.arms).toHaveLength(1);
      expect(alarm.cancels).toBe(1);
    });

    it('is ignored when it comes from a start that a newer one superseded', async () => {
      const { alarm, clock, to, dues } = await senderRig();
      const superseded = alarm.armedAt;
      to(3);

      await clock.start(microseconds(10_000), () => undefined);

      expect(alarm.armedAt).toBeCloseTo(13.3, 6);
      alarm.wake(superseded);
      expect(clock.wakeReadings().wakes).toBe(0);
      expect(dues).toHaveLength(0);

      alarm.wake(alarm.armedAt);
      expect(clock.wakeReadings().wakes).toBe(1);
    });
  });

  it('begins a second start from a fresh accumulator, so a leftover remainder cannot move the first due', async () => {
    const { alarm, clock, to } = await senderRig();
    alarm.wake(10.3, 10.3, 10.8); // leaves 0.8 ms owed towards the next frame
    to(100);
    const dues: number[] = [];

    await clock.start(microseconds(10_000), (dueAtMs) => dues.push(dueAtMs));
    alarm.wake(alarm.armedAt, alarm.armedAt, 110.3);

    expect(dues).toHaveLength(1);
    expect(dues[0]).toBeCloseTo(110, 6);
    expect(clock.stats.framesEmitted).toBe(1);
  });
});

describe('DeckTickClock switching source', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('only remembers the source for a clock that is not running, and has no sender without a link', () => {
    installFakeAudioContext();
    const link = new FakeLink();
    const clock = new DeckTickClock(link);

    clock.setSource('sender');

    expect(clock.source).toBe('sender');
    expect(link.alarms).toHaveLength(0);
    expect(FakeAudioContext.instances).toHaveLength(0);

    const noLink = new DeckTickClock(null);
    noLink.setSource('sender');
    expect(noLink.source).toBe('audio');
  });

  it('hands audio to the sender mid-play with the frame count running on and the dues one interval apart', async () => {
    const advance = installFakeNow();
    installFakeAudioContext();
    const link = new FakeLink();
    const clock = new DeckTickClock(link);
    const dues: number[] = [];
    await clock.start(microseconds(10_000), (dueAtMs) => dues.push(dueAtMs));
    const context = FakeAudioContext.instances[0];
    if (context.node === null) throw new Error('no graph');
    fireEvenly(context.node, advance, 8, 5);
    expect(clock.stats.framesEmitted).toBe(4);

    advance(20); // the audio source stalls
    clock.setSource('sender');

    expect(context.closed).toBe(true);
    expect(context.node.disconnected).toBe(true);
    const [alarm] = link.alarms;
    // Not stepped past now: the first wake's render catches up what is already due.
    expect(alarm.armedAt).toBeCloseTo(dues[dues.length - 1] + 10 + WAKE_EPSILON_MS, 6);

    alarm.wake(alarm.armedAt, alarm.armedAt, 60);

    expect(clock.stats.framesEmitted).toBe(6);
    dues.slice(1).forEach((due, i) => expect(due - dues[i]).toBeCloseTo(10, 6));
  });

  it('hands the sender to audio mid-play, and the first callback credits the measured time since the last tick', async () => {
    const { alarm, clock, to, dues, clamped } = await senderRig();
    alarm.wake(10.3);
    to(12);

    clock.setSource('audio');
    await settle();

    expect(alarm.cancels).toBe(1);
    const node = FakeAudioContext.instances[0].node;
    if (node === null) throw new Error('no graph');
    to(47.3); // resume() and the first buffer
    node.fireBuffers(1);

    expect(dues).toHaveLength(4);
    dues.slice(1).forEach((due, i) => expect(due - dues[i]).toBeCloseTo(10, 6));
    expect(clamped.every((flagged) => !flagged)).toBe(true);
    expect(clock.stats.framesEmitted).toBe(4);

    to(52.3);
    node.fireBuffers(1);
    // The first callback spanned resume(), so it is not a gap the clock kept.
    expect(clock.stats.worstGapMs).toBeCloseTo(5, 6);
  });

  it('says once that the audio clock waits for a click when resume() hangs for a second on a switch', async () => {
    const { clock } = await senderRig();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const resume = deferredResume();

    clock.setSource('audio');
    vi.advanceTimersByTime(999);
    expect(console.warn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(console.warn).toHaveBeenCalledTimes(1);
    resume.settle();
  });

  it('keeps two decks within a frame of each other and of real time through a silent sender and the fallback', async () => {
    const advance = installFakeNow();
    installFakeAudioContext();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const link = new FakeLink();
    const intervalMs = 20;
    const clamps: boolean[] = [];
    const startClock = async (): Promise<DeckTickClock> => {
      const clock = new DeckTickClock(link);
      clock.setSource('sender');
      await clock.start(microseconds(intervalMs * 1000), (_due, clamped) => clamps.push(clamped));
      return clock;
    };
    let at = 0;
    const to = (ms: number): void => {
      advance(ms - at);
      at = ms;
    };
    const runWakesUntil = (alarm: FakeAlarm, untilMs: number): void => {
      while (alarm.armedAt <= untilMs) {
        alarm.wake(alarm.armedAt);
      }
    };

    const deckA = await startClock(); // starts at 0, wakes at 20.3, 40.3 ...
    to(10);
    const deckB = await startClock(); // half an interval later
    const [alarmA, alarmB] = link.alarms;
    runWakesUntil(alarmA, 100.3);
    runWakesUntil(alarmB, 110.3);

    // 900 ms with no wake from either, and the link's beat every 250 ms.
    for (const beatAt of [250, 500, 750, 1000]) {
      to(beatAt);
      alarmA.beat(beatAt);
      alarmB.beat(beatAt);
    }
    to(1010);
    deckA.setSource('audio');
    deckB.setSource('audio');
    await settle();
    to(1015);
    for (const instance of FakeAudioContext.instances) {
      instance.node?.fireBuffers(1);
    }

    const framesA = deckA.stats.framesEmitted;
    const framesB = deckB.stats.framesEmitted;
    expect(Math.abs(framesA - Math.floor(1015 / intervalMs))).toBeLessThanOrEqual(1);
    expect(Math.abs(framesB - Math.floor((1015 - 10) / intervalMs))).toBeLessThanOrEqual(1);
    expect(Math.abs(framesA - framesB)).toBeLessThanOrEqual(1);
    expect(clamps.some((clamped) => clamped)).toBe(false);
    expect(deckA.wakeReadings().guardRearms).toBeGreaterThan(0);
  });
});
