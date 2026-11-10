import {
  createFrameAccumulator,
  MAX_CATCH_UP_US,
  MICROSECONDS_PER_SECOND,
  microseconds,
  milliseconds,
} from '@sidablist/core';
import type {
  FrameAccumulator,
  FrameClockStats,
  Microseconds,
  Milliseconds,
} from '@sidablist/core';
import { Histogram, summarizeLateness } from '@teensyrom-nx/asid-sender-protocol';
import type {
  DeckFrameClock,
  IAsidSenderLink,
  SenderWakeAlarm,
  TickSource,
  WakeReadings,
} from '@teensyrom-nx/application';
import { logWarn } from '@teensyrom-nx/utils';

const MICROSECONDS_PER_MILLISECOND = 1000;

/** Frames per `createScriptProcessor` buffer — 256 is ≈ 5.3 ms at 48 kHz. */
const AUDIO_BUFFER_FRAMES = 256;

/** A callback gap beyond this multiple of the nominal buffer duration counts as late. */
const LATE_CALLBACK_FACTOR = 2;

/** How far past a frame's due time its wake is asked for, so the wake never lands just before it. */
export const WAKE_EPSILON_MS = 0.3;

/** A wake counts as the armed one when the time it was asked for is this close to the armed time:
 *  the shared-time round trip is exact to float error, which at today's magnitudes is far inside. */
const WAKE_MATCH_TOLERANCE_MS = 0.01;

/** The chain is silent when no wake has been handled for the larger of this and three intervals. */
const SILENT_CHAIN_MIN_MS = 100;
const SILENT_CHAIN_INTERVALS = 3;

/** How long `resume()` may stay pending before the page is told the audio clock waits for a click. */
const RESUME_WARN_MS = 1000;

/**
 * A deck's frame clock, ticking from one of two sources and able to hand over between them while it
 * runs without losing a frame or the time owed.
 *
 * The **sender** source is the timing helper's wake: the clock asks the sender's loop to wake it at
 * the next frame's due time and renders from the wake, so a frame is made within a fraction of a
 * millisecond of when it is due. The **audio** source is a silent audio graph whose
 * `ScriptProcessorNode` callback fires every buffer on the main thread — it keeps firing while the
 * tab is hidden, where `setTimeout` is throttled, and costs no thread crossing to reach Web MIDI's
 * main-thread-only `send()`. An `AudioWorklet` would have to `postMessage` back and land in the same
 * task queue anyway.
 *
 * Both feed one `FrameAccumulator` with the time that actually passed since the last tick, never
 * the time a source nominally advertises, so a switch of source keeps the frame count and the due
 * times continuous. With no link only the audio source exists.
 */
export class DeckTickClock implements DeckFrameClock {
  private tickSource: TickSource = 'audio';
  private running = false;
  private accumulator: FrameAccumulator | null = null;
  private onFrame: ((dueAtMs: Milliseconds, catchUpClamped: boolean) => void) | null = null;

  private startedAtMs = 0;
  private lastTickAtMs = 0;
  private lastDueAtMs = 0;
  // The end of the span the running advance credits, and whether that span was clamped. Held as
  // fields so the frame handler is built once rather than per tick: allocating on this path is the
  // jitter the clock exists to measure.
  private creditedUntilMs = 0;
  private catchUpClamped = false;

  // Running sums rather than a kept list of samples, for the same reason.
  private gapCount = 0;
  private gapSumMs = 0;
  private gapSumSqMs = 0;
  private worstGapMs = 0;
  private lateCallbacks = 0;

  private context: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;
  // Bumped by every `stop()` and every audio start. An audio start captures it as its own token:
  // `resume()` is the only await between creating an `AudioContext` and publishing it, and if the
  // token has moved on by the time it settles, a later start, a stop or a switch of source ran in
  // the meantime and this context is superseded — closed rather than wired up.
  private startToken = 0;

  private alarm: SenderWakeAlarm | null = null;
  /** The time of the one armed wake, or null; a wake that was not asked for this time is stale. */
  private armedAtMs: number | null = null;
  private lastWakeAtMs = 0;
  private lastHandledWakeAtMs: number | null = null;
  private silentLogged = false;
  private wakes = 0;
  private early = 0;
  private guardRearms = 0;
  private readonly senderLate = new Histogram();
  private readonly mixerLate = new Histogram();

  /** @param link the sender to ask for wakes; null leaves the clock on the audio source. */
  constructor(private readonly link: IAsidSenderLink | null) {}

  get source(): TickSource {
    return this.tickSource;
  }

  get stats(): FrameClockStats {
    const accumulator = this.accumulator;
    if (accumulator === null) {
      return {
        framesEmitted: 0,
        measuredMeanIntervalUs: microseconds(0),
        nominalIntervalUs: microseconds(0),
        driftMs: milliseconds(0),
        jitterMs: milliseconds(0),
        worstGapMs: milliseconds(0),
        lateCallbacks: 0,
      };
    }

    const measuredElapsedUs = (this.lastTickAtMs - this.startedAtMs) * MICROSECONDS_PER_MILLISECOND;
    const framesEmitted = accumulator.framesEmitted;
    return {
      framesEmitted,
      measuredMeanIntervalUs: microseconds(
        framesEmitted === 0 ? 0 : measuredElapsedUs / framesEmitted
      ),
      nominalIntervalUs: accumulator.nominalIntervalUs,
      driftMs: milliseconds(
        (measuredElapsedUs - accumulator.nominalElapsedUs) / MICROSECONDS_PER_MILLISECOND
      ),
      jitterMs: milliseconds(this.gapStandardDeviationMs()),
      worstGapMs: milliseconds(this.worstGapMs),
      lateCallbacks: this.lateCallbacks,
    };
  }

  wakeReadings(): WakeReadings {
    return {
      wakes: this.wakes,
      early: this.early,
      guardRearms: this.guardRearms,
      senderLateMs: summarizeLateness(this.senderLate),
      mixerLateMs: summarizeLateness(this.mixerLate),
    };
  }

  resetWakeReadings(): void {
    this.wakes = 0;
    this.early = 0;
    this.guardRearms = 0;
    this.senderLate.reset();
    this.mixerLate.reset();
  }

  /** @throws {RangeError} when `intervalUs` is not a positive finite number. */
  async start(
    intervalUs: Microseconds,
    onFrame: (dueAtMs: Milliseconds, catchUpClamped: boolean) => void
  ): Promise<void> {
    assertPositiveInterval(intervalUs);
    this.stop();

    const nowMs = performance.now();
    this.onFrame = onFrame;
    this.accumulator = createFrameAccumulator(intervalUs);
    this.resetTiming(nowMs);
    this.running = true;

    if (this.tickSource === 'sender') {
      this.beginSender(nowMs);
      return;
    }
    await this.startAudio(true);
  }

  /**
   * Ignored before the first `start`, which carries its own interval. On the sender source the armed
   * wake is replaced at once, aimed at the next due time at the new interval.
   *
   * @throws {RangeError} when `intervalUs` is not a positive finite number.
   */
  setIntervalUs(intervalUs: Microseconds): void {
    const accumulator = this.accumulator;
    if (accumulator === null) {
      return;
    }
    accumulator.setIntervalUs(intervalUs);
    if (this.running && this.tickSource === 'sender') {
      this.arm(this.rearmAt());
    }
  }

  /** Cancels the armed wake or tears the audio graph down. Keeps the accumulator, so `stats` still
   *  reads after a stop, and invalidates any audio start still waiting on `resume()`. */
  stop(): void {
    this.running = false;
    this.cancelWake();
    this.stopAudio();
  }

  setSource(source: TickSource): void {
    if (source === this.tickSource || (source === 'sender' && this.link === null)) {
      return;
    }
    this.tickSource = source;
    if (!this.running) {
      return;
    }

    if (source === 'sender') {
      this.stopAudio();
      this.beginSender(performance.now());
      return;
    }
    this.cancelWake();
    // Nobody awaits a switch, so a refused `resume()` is reported rather than thrown.
    this.startAudio(false).catch((error: unknown) =>
      logWarn(
        `DeckTickClock: the audio clock could not start — ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    );
  }

  // ---- shared timing ---------------------------------------------------------------------------

  private resetTiming(nowMs: number): void {
    this.startedAtMs = nowMs;
    this.lastTickAtMs = nowMs;
    this.lastDueAtMs = nowMs;
    this.creditedUntilMs = nowMs;
    this.catchUpClamped = false;
    this.gapCount = 0;
    this.gapSumMs = 0;
    this.gapSumSqMs = 0;
    this.worstGapMs = 0;
    this.lateCallbacks = 0;
  }

  private noteGap(gapMs: number): void {
    this.gapCount++;
    this.gapSumMs += gapMs;
    this.gapSumSqMs += gapMs * gapMs;
    if (gapMs > this.worstGapMs) this.worstGapMs = gapMs;
  }

  /** Population standard deviation from the running sums, floored at 0 against float cancellation. */
  private gapStandardDeviationMs(): number {
    if (this.gapCount < 2) {
      return 0;
    }
    const mean = this.gapSumMs / this.gapCount;
    return Math.sqrt(Math.max(0, this.gapSumSqMs / this.gapCount - mean * mean));
  }

  /**
   * Credits the accumulator with `elapsedUs` and releases every frame now due, returning how many.
   * Every frame this advance releases is placed against `nowMs` rather than a second reading: the
   * span just credited ends there, and each frame's own lag says how far back inside it the frame
   * fell due.
   */
  private credit(nowMs: number, elapsedUs: number, accumulator: FrameAccumulator): number {
    // Resolved before the advance rather than from its return value: `emitFrame` reads this flag as
    // each frame is released, so it has to be right by the time the first one comes out. The
    // accumulator applies `MAX_CATCH_UP_US` itself, so the measured span goes over unclamped.
    this.catchUpClamped = elapsedUs > MAX_CATCH_UP_US;
    this.lastTickAtMs = nowMs;
    this.creditedUntilMs = nowMs;
    const before = accumulator.framesEmitted;
    accumulator.advance(microseconds(elapsedUs), this.emitFrame);
    return accumulator.framesEmitted - before;
  }

  private readonly emitFrame = (lagUs: Microseconds): void => {
    const dueAtMs = this.creditedUntilMs - lagUs / MICROSECONDS_PER_MILLISECOND;
    this.lastDueAtMs = dueAtMs;
    this.onFrame?.(milliseconds(dueAtMs), this.catchUpClamped);
  };

  // ---- the sender source -----------------------------------------------------------------------

  /** Starts ticking from the sender's wake. The beat that lands before the first wake is not a
   *  broken chain, so the silence is counted from now. */
  private beginSender(nowMs: number): void {
    this.lastHandledWakeAtMs = null;
    this.lastWakeAtMs = nowMs;
    this.silentLogged = false;
    this.arm(this.rearmAt());
  }

  /** Where an arm made outside a wake aims: the frame after the last one released, not stepped past
   *  now. The render that follows the wake catches up everything due by then, whereas stepping here
   *  would hold a frame that is already due back by one more interval. */
  private rearmAt(): number {
    return this.lastDueAtMs + this.intervalMs() + WAKE_EPSILON_MS;
  }

  /** The first due time after `nowMs`: the last due plus whole intervals. */
  private nextDueAfter(nowMs: number, intervalMs: number): number {
    const next = this.lastDueAtMs + intervalMs;
    return next > nowMs ? next : next + (Math.floor((nowMs - next) / intervalMs) + 1) * intervalMs;
  }

  private intervalMs(): number {
    return (this.accumulator?.nominalIntervalUs ?? 0) / MICROSECONDS_PER_MILLISECOND;
  }

  private arm(atMs: number): void {
    const link = this.link;
    if (link === null) {
      return;
    }
    this.alarm ??= link.wakeAlarm(this.onWake, this.onBeat);
    this.armedAtMs = atMs;
    this.alarm.arm(atMs);
  }

  private cancelWake(): void {
    if (this.armedAtMs === null) {
      return;
    }
    this.armedAtMs = null;
    this.alarm?.cancel();
  }

  /**
   * One wake. A wake can arrive after a stop, a pause, a switch to the audio source, a newer start
   * or a speed change's re-arm — the sender may have sent it before the cancel or the replacement
   * reached it — and one alarm id cannot tell those apart, so only a wake asked for the armed time
   * on a running sender clock is handled, and any other is dropped.
   */
  private readonly onWake = (askedAtMs: number, sentAtMs: number, nowMs: number): void => {
    const accumulator = this.accumulator;
    if (
      accumulator === null ||
      !this.running ||
      this.tickSource !== 'sender' ||
      this.armedAtMs === null ||
      Math.abs(askedAtMs - this.armedAtMs) >= WAKE_MATCH_TOLERANCE_MS
    ) {
      return;
    }

    const intervalMs = accumulator.nominalIntervalUs / MICROSECONDS_PER_MILLISECOND;
    this.wakes++;
    this.senderLate.add(sentAtMs - askedAtMs);
    this.mixerLate.add(nowMs - sentAtMs);
    if (this.lastHandledWakeAtMs !== null) {
      this.noteGap(nowMs - this.lastHandledWakeAtMs);
    }
    if (nowMs - (askedAtMs - WAKE_EPSILON_MS) > intervalMs) {
      this.lateCallbacks++;
    }

    // Ask for the next wake before rendering, so a render that throws cannot end the chain.
    this.arm(this.nextDueAfter(nowMs, intervalMs) + WAKE_EPSILON_MS);
    try {
      if (
        this.credit(
          nowMs,
          (nowMs - this.lastTickAtMs) * MICROSECONDS_PER_MILLISECOND,
          accumulator
        ) === 0
      ) {
        this.early++;
      }
    } finally {
      this.lastHandledWakeAtMs = nowMs;
      this.lastWakeAtMs = nowMs;
      this.silentLogged = false;
    }
  };

  /**
   * The link's steady beat, which doubles as the backstop tick. A chain that has gone silent — a
   * wake the sender refused or lost never comes back — renders the frames that fell due and asks
   * again, on every such beat, so each deck's position keeps pace with real time through a hung or
   * crashed sender until the health machine falls back to the audio source, and the two decks
   * cannot drift apart by the difference in their last wakes.
   */
  private readonly onBeat = (nowMs: number): void => {
    const accumulator = this.accumulator;
    if (accumulator === null || !this.running || this.tickSource !== 'sender') {
      return;
    }
    const intervalMs = accumulator.nominalIntervalUs / MICROSECONDS_PER_MILLISECOND;
    const silentMs = nowMs - this.lastWakeAtMs;
    if (silentMs <= Math.max(SILENT_CHAIN_MIN_MS, SILENT_CHAIN_INTERVALS * intervalMs)) {
      return;
    }

    if (!this.silentLogged) {
      this.silentLogged = true;
      logWarn(
        `DeckTickClock: no wake from the sender for ${Math.round(
          silentMs
        )} ms; rendering from the beat until it answers`
      );
    }
    this.guardRearms++;
    try {
      this.credit(nowMs, (nowMs - this.lastTickAtMs) * MICROSECONDS_PER_MILLISECOND, accumulator);
    } finally {
      this.arm(this.rearmAt());
    }
  };

  // ---- the audio source ------------------------------------------------------------------------

  /**
   * Builds the silent graph and starts crediting from its callbacks. A fresh start re-anchors the
   * timing after `resume()` and credits its first callback one buffer duration; a switch from the
   * sender keeps the anchor, so its first callback credits the measured time since the last tick and
   * the frames that fell due during `resume()` come out at once, as a stall's do. The switch has no
   * fresh click: it relies on the page's earlier activation, and says so if `resume()` hangs.
   */
  private async startAudio(freshStart: boolean): Promise<void> {
    const myToken = ++this.startToken;
    const context = new AudioContext();
    const waiting = setTimeout(
      () => logWarn('DeckTickClock: the audio clock is waiting for a click on the page'),
      RESUME_WARN_MS
    );
    try {
      await context.resume();
    } catch (error) {
      // Never leak the context a rejected resume() leaves unassigned.
      void context.close().catch(() => undefined);
      if (freshStart && myToken === this.startToken) {
        this.running = false;
      }
      throw error;
    } finally {
      clearTimeout(waiting);
    }

    if (myToken !== this.startToken) {
      // Superseded while `resume()` was pending. Never publish this graph, and close the context
      // nothing else will ever stop.
      void context.close().catch(() => undefined);
      return;
    }

    const node = context.createScriptProcessor(AUDIO_BUFFER_FRAMES, 1, 1);
    const sink = context.createGain();
    sink.gain.value = 0;
    node.connect(sink);
    // The node is only pumped while its graph reaches the destination, silent or not.
    sink.connect(context.destination);

    const bufferDurationUs = (AUDIO_BUFFER_FRAMES / context.sampleRate) * MICROSECONDS_PER_SECOND;
    const lateThresholdMs =
      (bufferDurationUs * LATE_CALLBACK_FACTOR) / MICROSECONDS_PER_MILLISECOND;
    if (freshStart) {
      this.resetTiming(performance.now());
    }

    let firstCallback = true;
    node.onaudioprocess = () => {
      const accumulator = this.accumulator;
      if (accumulator === null) {
        return;
      }
      const now = performance.now();

      // Credit the accumulator with the time that actually passed, not with the buffer duration the
      // sample rate implies. Those differ by a fraction of a percent — the audio device's crystal
      // against `performance.now()` — and that fraction is a *sustained rate error*: the cartridge
      // re-times playback to the interval this clock advertises, so a stream that runs slow against
      // its own advertised rate drains the cartridge's queue faster than it fills, until the
      // firmware's slow re-timer claws it back and the depth oscillates. Measuring instead of
      // assuming keeps the advertised rate honest.
      //
      // It also makes a stall self-correcting: no callback means no packet, and the cartridge drains
      // straight through it. Advancing by real elapsed time emits exactly the frames that fell due
      // and restores the depth the stall cost, where a fixed-duration advance would leave the queue
      // permanently shallower.
      const gapMs = now - this.lastTickAtMs;
      const elapsedUs =
        firstCallback && freshStart ? bufferDurationUs : gapMs * MICROSECONDS_PER_MILLISECOND;
      if (!firstCallback) {
        this.noteGap(gapMs);
        if (gapMs > lateThresholdMs) this.lateCallbacks++;
      }
      firstCallback = false;
      this.credit(now, elapsedUs, accumulator);
    };

    this.context = context;
    this.node = node;
    this.sink = sink;
  }

  /** Tears the audio graph down, and invalidates any audio start still waiting on `resume()`. */
  private stopAudio(): void {
    this.startToken++;
    if (this.node !== null) {
      this.node.onaudioprocess = null;
      this.node.disconnect();
      this.node = null;
    }
    this.sink?.disconnect();
    this.sink = null;

    const context = this.context;
    this.context = null;
    // Closing is asynchronous and nothing downstream waits on it; a failure to close a context we
    // have already detached is not worth surfacing.
    void context?.close().catch(() => undefined);
  }
}

function assertPositiveInterval(intervalUs: number): void {
  if (!Number.isFinite(intervalUs) || intervalUs <= 0) {
    throw new RangeError(`frame interval ${intervalUs} µs must be a positive finite number`);
  }
}
