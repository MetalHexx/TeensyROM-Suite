import { Injectable, inject, isDevMode } from '@angular/core';
import { midiPortDeviceToken } from '@teensyrom-nx/domain';
import { logWarn } from '@teensyrom-nx/utils';
import {
  createSidPlayer,
  parseSidFile,
  frames,
  clamp,
  playCallIntervalUs,
  SID_REGISTER_COUNT,
} from '@sidablist/core';
import type {
  ActiveLoop,
  CrossingLines,
  DeliveryBatch,
  SidPlayer,
  PlayerSnapshot,
  Frames,
  Milliseconds,
  ReplayRunner,
  JumpSettings,
  ShadowCount,
  SidField,
  SidFrame,
  SidModel,
  VarispeedLoopStart,
  VarispeedRateSource,
} from '@sidablist/core';
import { noteStarts } from '@sidablist/analysis';
import type { NoteStarts } from '@sidablist/analysis';
import { createAsidSink } from '@sidablist/asid';
import type { AsidSink, MidiOutputPort } from '@sidablist/asid';
import type { Playable } from '@sidablist/tunes';
import {
  FRAME_CLOCK_FACTORY,
  REPLAY_RUNNER_FACTORY,
  REGISTER_RECORDER_FACTORY,
  MIDI_ACCESS,
} from './ports';
import type { DeckFrameClock, RegisterRecorder, TickSource } from './ports';
import type { Slot } from './slot';
import { DeliveryProbe } from './bench/delivery-probe';
import { PressProbe, type PressKind } from './bench/press-probe';
import { installDeckBench } from './bench/deck-bench';
import { DeckSendRoute } from './sender/deck-send-route';

/** How many seconds of play a tune's register record covers beyond the longest position the
 *  transport can show, so a hand has room to run past the end of the bar. */
const RECORD_MARGIN_SECONDS = 5;

/** One deck slot's whole engine bundle: the core player, its ASID sink, the clock driving it (from
 *  the sender's wake or the audio graph), the two replay threads it uses — one for jumps, one for
 *  prepared builds — and the recorder that scans the loaded tune's register record. */
export interface SlotRuntime {
  readonly player: SidPlayer;
  readonly sink: AsidSink;
  readonly clock: DeckFrameClock;
  readonly replay: ReplayRunner;
  readonly prepare: ReplayRunner;
  readonly recorder: RegisterRecorder;
}

/** A loop as the runtime hands it to the engine: its bounds in play calls — the end need not be a
 *  whole frame — how varispeed holds it, and the lap phase a length that is not a whole number of
 *  frames alternates its laps from (core's `ActiveLoop`). */
export interface EngineLoop {
  readonly startFrame: number;
  readonly endFrame: number;
  readonly varispeedStart?: VarispeedLoopStart;
  readonly lapPhase?: number;
}

/** `loop` in the engine's units, carrying only the optional fields it has. */
function engineLoopOf(loop: EngineLoop): Exclude<ActiveLoop, null> {
  return {
    startFrame: frames(loop.startFrame),
    endFrame: frames(loop.endFrame),
    ...(loop.varispeedStart === undefined ? {} : { varispeedStart: loop.varispeedStart }),
    ...(loop.lapPhase === undefined ? {} : { lapPhase: loop.lapPhase }),
  };
}

/** The façade's mutable target: which port id a slot currently points at, the `TeensyRom-<id>`
 *  token of the cartridge behind it (what the timing helper lists), whether the "nothing bound"
 *  warning has already fired for the unbound stretch in progress, and whether the next packet
 *  must leave unstamped. */
interface FacadeState {
  portId: string | null;
  token: string | null;
  warned: boolean;
  unstampedOnce: boolean;
}

/** The registers a slot's deck last sent, as one frame carrying all of them. Built once per slot:
 *  `sendRegisterImage` refills `sent` and nothing else changes. */
interface RegisterImage {
  readonly written: Uint8Array;
  readonly sent: Uint8Array;
  readonly frame: SidFrame;
}

function createRegisterImage(): RegisterImage {
  const written = new Uint8Array(SID_REGISTER_COUNT);
  const sent = new Uint8Array(SID_REGISTER_COUNT);
  return {
    written,
    sent,
    frame: {
      count: SID_REGISTER_COUNT,
      registers: Uint8Array.from({ length: SID_REGISTER_COUNT }, (_, register) => register),
      values: sent,
      offsetsUs: new Int32Array(SID_REGISTER_COUNT),
    },
  };
}

/**
 * Owns one engine bundle per deck slot — built once, torn down once — and the MIDI port façade
 * each bundle's sink sends through. Lifted from the POC's `DeckHostComponent` providers and
 * `DeckMidiBinding.createOutputPort`, collapsed onto two slots instead of one deck host per
 * component instance. The façade sends through the mixer's own MIDI access or, when `DeckSendRoute`
 * says so, through the timing helper; the supervisor owns that decision and this class only acts
 * on it.
 *
 * `build` creates no `AudioContext`: the clock's graph starts on the first `play` — and only when
 * the clock ticks from the audio source — inside the factory-supplied `DeckFrameClock`'s own
 * `start()`, never here. `build` only points the clock at the source the live send path calls for.
 */
@Injectable({ providedIn: 'root' })
export class DeckRuntime {
  private readonly clockFactory = inject(FRAME_CLOCK_FACTORY);
  private readonly replayFactory = inject(REPLAY_RUNNER_FACTORY);
  private readonly recorderFactory = inject(REGISTER_RECORDER_FACTORY);
  private readonly midiAccess = inject(MIDI_ACCESS);
  private readonly route = inject(DeckSendRoute);

  private readonly slots = new Map<Slot, SlotRuntime>();
  private readonly facades = new Map<Slot, FacadeState>();
  private readonly images = new Map<Slot, RegisterImage>();
  /** The chip model of the tune each slot last loaded — what `resync` hands the sink's `begin`. */
  private readonly chipModels = new Map<Slot, SidModel>();
  /** Bumped by every `load`: a record scan that comes back after a newer load is stale. */
  private readonly loadGenerations = new Map<Slot, number>();
  /** The note starts of each slot's loaded tune, computed where its register record lands. */
  private readonly noteStartsBySlot = new Map<Slot, NoteStarts>();
  /** Each slot's delivery probe — dev builds only, read through the console bench. */
  private readonly probes = new Map<Slot, DeliveryProbe>();
  /** Each slot's press probe — dev builds only, read through the console bench. */
  private readonly pressProbes = new Map<Slot, PressProbe>();

  constructor() {
    if (isDevMode()) {
      installDeckBench(() =>
        [...this.slots].map(([slot, { player, sink, clock }]) => ({
          slot,
          player,
          sink,
          clock,
          probe: this.requireProbe(slot),
          presses: this.requirePressProbe(slot),
        }))
      );
    }
  }

  /** Builds this slot's engine bundle, once. A second call is a no-op — the sink, the player, the
   *  clock and the replay threads are never rebuilt for a slot already built. */
  build(slot: Slot): void {
    if (this.slots.has(slot)) {
      return;
    }

    const facade: FacadeState = { portId: null, token: null, warned: false, unstampedOnce: false };
    this.facades.set(slot, facade);
    this.images.set(slot, createRegisterImage());
    const scheduleAheadMs = this.route.lookaheadFor(this.route.path());
    if (isDevMode()) {
      const probe = new DeliveryProbe();
      probe.setScheduleAhead(scheduleAheadMs);
      this.probes.set(slot, probe);
      this.pressProbes.set(slot, new PressProbe());
    }

    const port = this.createOutputPort(slot, facade);
    const sink = createAsidSink(port, { scheduleAheadMs });
    const clock = this.clockFactory();
    clock.setSource(this.route.path() === 'sender' ? 'sender' : 'audio');
    const replay = this.replayFactory();
    const prepare = this.replayFactory();
    const recorder = this.recorderFactory();
    const player = createSidPlayer({ sink, clock, replayRunner: replay, prepareRunner: prepare });
    player.setRepeatTrack(true);

    this.slots.set(slot, { player, sink, clock, replay, prepare, recorder });
  }

  /** Re-targets this slot's port façade. The sink and player are never rebuilt — only the id the
   *  façade resolves against on the next send changes. Also records the cartridge token in the
   *  port's name, which is how the timing helper addresses it. Resets the unbound-stretch warning
   *  so an unbound slot warns again the next time it drops bytes. */
  setPort(slot: Slot, portId: string | null): void {
    const facade = this.requireFacade(slot);
    facade.portId = portId;
    facade.token = portId === null ? null : this.tokenOfPort(portId);
    facade.warned = false;
  }

  /** The `TeensyRom-<id>` token of the cartridge this slot's port belongs to, or null with no port
   *  bound, a port whose name carries none, or a slot not built. */
  deviceToken(slot: Slot): string | null {
    return this.facades.get(slot)?.token ?? null;
  }

  /** Whether this slot's deck is sending frames: playing, or in varispeed, where the hand runs the
   *  clock while the transport still reads `paused`. False for a slot not built. */
  isPlaying(slot: Slot): boolean {
    const entry = this.slots.get(slot);
    if (entry === undefined) {
      return false;
    }
    const { transport, tempo } = entry.player.getSnapshot();
    return transport === 'playing' || tempo.varispeed;
  }

  /** Sets how far past its due time this slot's sink stamps each frame, and in dev builds points the
   *  delivery probe at the value the sink settled on, keeping what it has recorded: a path change
   *  must not restart a reading. Does nothing for a slot not built. */
  setScheduleAhead(slot: Slot, ms: Milliseconds): void {
    const entry = this.slots.get(slot);
    if (entry === undefined) {
      return;
    }
    entry.sink.setScheduleAhead(ms);
    const probe = this.probes.get(slot);
    if (probe !== undefined) {
      probe.setScheduleAhead(entry.sink.capabilities.scheduleAheadMs ?? 0);
    }
  }

  /** Hands this slot's frame clock to `source` at once, keeping its place. Does nothing for a slot
   *  not built. */
  setTickSource(slot: Slot, source: TickSource): void {
    this.slots.get(slot)?.clock.setSource(source);
  }

  /** Dev builds: marks a press reaching this slot's engine, for the press-to-wire reading. Does
   *  nothing in production or for a slot not built. */
  markPress(slot: Slot, kind: PressKind): void {
    this.pressProbes.get(slot)?.mark(kind, performance.now());
  }

  /** Dev builds: the engine has taken the press pending on this slot — a nudge's panel apply. Does
   *  nothing in production or for a slot not built. */
  notePressApplied(slot: Slot): void {
    this.pressProbes.get(slot)?.applied();
  }

  /** The schedule-ahead this slot's sink settled on, in ms (it caps the value asked for); 0 for a
   *  slot not built. */
  scheduleAheadOf(slot: Slot): number {
    return this.slots.get(slot)?.sink.capabilities.scheduleAheadMs ?? 0;
  }

  /** Puts every register this deck last sent on the wire at once, unstamped, so the chip matches the
   *  deck after a change of path. Does nothing for a deck that is not sending frames.
   *
   *  Unstamped on either path: on a port that cannot cancel the sink would stamp it just behind the
   *  last frame it stamped, which outlives a switch — coming off the sender that is still about
   *  15 ms ahead, so frames stamped for now would go first and the late image would put back what
   *  they wrote. The path now live holds nothing earlier for this deck. */
  sendRegisterImage(slot: Slot): void {
    const entry = this.slots.get(slot);
    const facade = this.facades.get(slot);
    const image = this.images.get(slot);
    if (
      entry === undefined ||
      facade === undefined ||
      image === undefined ||
      !this.isPlaying(slot)
    ) {
      return;
    }
    entry.player.readRegisters(image.written, image.sent);
    facade.unstampedOnce = true;
    try {
      entry.sink.deliverNow(image.frame);
    } finally {
      facade.unstampedOnce = false;
    }
  }

  /** Re-sends the ASID start handshake — SID type, then start — to this slot's cartridge. A
   *  cartridge that went away was power-cycled and missed the one `begin` a tune sends when it
   *  starts, so it must hear it again once its port returns. Does nothing with no tune loaded. */
  resync(slot: Slot): void {
    const { sink } = this.requireSlot(slot);
    const chipModel = this.chipModels.get(slot);
    if (chipModel !== undefined) {
      sink.begin({ chipModel });
    }
  }

  /** Re-sends the ASID stop message the sink sends when a deck ends or pauses, to this slot's
   *  cartridge. Stopping twice is harmless. Does nothing for a slot not built. */
  sendStop(slot: Slot): void {
    this.slots.get(slot)?.sink.end();
  }

  /** Hands a resolved tune to this slot's player: loads it, selects its subtune, lands whatever
   *  structure the tune's index carries, and asks the slot's recorder for the tune's register
   *  record, which the player takes when it arrives. The one funnel for a tune load and a subtune
   *  switch, so both get a record. */
  load(slot: Slot, playable: Playable): void {
    const { player, recorder } = this.requireSlot(slot);
    const file = parseSidFile(playable.bytes);
    player.loadTune(file);
    this.chipModels.set(slot, file.model);
    player.selectSubtune(playable.reference.identity.subtune);

    const { index } = playable;
    player.setTrackStructure({
      loopStartFrame: index.loopStartFrame === null ? null : frames(index.loopStartFrame),
      loopPeriodFrames: index.loopPeriodFrames === null ? null : frames(index.loopPeriodFrames),
      endedAtFrame: index.endedAtFrame === null ? null : frames(index.endedAtFrame),
    });

    const generation = (this.loadGenerations.get(slot) ?? 0) + 1;
    this.loadGenerations.set(slot, generation);
    this.noteStartsBySlot.delete(slot);
    const { basis } = player.getSnapshot();
    const recordFrames =
      Math.max(basis.positionBasisFrames, basis.ceilingFrames) +
      Math.round((RECORD_MARGIN_SECONDS * 1e6) / this.playCallIntervalUs(slot));
    recorder
      .record(playable.bytes, playable.reference.identity.subtune, recordFrames)
      .then((record) => {
        if (record !== null && this.loadGenerations.get(slot) === generation) {
          player.setRegisterRecord(record);
          this.noteStartsBySlot.set(slot, noteStarts(record));
        }
      })
      .catch((error: unknown) =>
        logWarn(
          `DeckRuntime: slot ${slot} register scan failed — ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      );
  }

  play(slot: Slot): Promise<void> {
    return this.requireSlot(slot).player.play();
  }

  pause(slot: Slot): void {
    this.requireSlot(slot).player.pause();
  }

  stop(slot: Slot): void {
    this.requireSlot(slot).player.stop();
  }

  /** The φ2 of the machine this slot's cartridge sits in, or `null` when it is not known. The player
   *  holds it across loads and reads each tune's own clock from its header, so this is called when
   *  the machine changes, never per tune. */
  setTargetClock(slot: Slot, targetHz: number | null): void {
    this.requireSlot(slot).player.setTargetClock(targetHz);
  }

  /** Voice 0…2's pitch multiplier — composes with the clock correction in the library. */
  setVoicePitch(slot: Slot, voice: number, multiplier: number): void {
    this.requireSlot(slot).player.setVoicePitch(voice, multiplier);
  }

  /** A signed offset in the field's own units; 0 clears it. */
  setFieldOffset(slot: Slot, field: SidField, amount: number): void {
    const { player } = this.requireSlot(slot);
    if (amount === 0) {
      player.clearFieldOffset(field);
    } else {
      player.setFieldOffset(field, amount);
    }
  }

  /** Holds a field at `value` on this slot's engine — see `SidPlayer.holdField`. */
  holdField(slot: Slot, field: SidField, value: number): void {
    this.requireSlot(slot).player.holdField(field, value);
  }

  /** Releases a field held by `holdField`; releasing one that is not held does nothing. */
  releaseField(slot: Slot, field: SidField): void {
    this.requireSlot(slot).player.releaseField(field);
  }

  /** The registers as written and as sent, into caller-owned buffers — allocates nothing. */
  readRegisters(slot: Slot, written: Uint8Array, sent: Uint8Array): void {
    this.requireSlot(slot).player.readRegisters(written, sent);
  }

  /** Asks this slot's player to keep up to `capacity` delivery entries between drains; 0 turns the
   *  history off. */
  keepDeliveries(slot: Slot, capacity: number): void {
    this.requireSlot(slot).player.keepDeliveries(capacity);
  }

  /** Moves the delivery entries kept since the last drain into the caller-owned batch. */
  drainDeliveries(slot: Slot, into: DeliveryBatch): void {
    this.requireSlot(slot).player.drainDeliveries(into);
  }

  /** Sets this slot's tempo multiplier (1 = the tune's own speed). */
  setTempo(slot: Slot, multiplier: number): void {
    this.requireSlot(slot).player.setTempo(multiplier);
  }

  /** Latches a voice's mute (voice 0…2). */
  setVoiceMuted(slot: Slot, voice: number, muted: boolean): void {
    this.requireSlot(slot).player.setVoiceMuted(voice, muted);
  }

  /** Momentarily holds a voice (voice 0…2). */
  setVoiceHeld(slot: Slot, voice: number, held: boolean): void {
    this.requireSlot(slot).player.setVoiceHeld(voice, held);
  }

  /** Clears every latched voice mute; holds are untouched. */
  clearVoiceMutes(slot: Slot): void {
    this.requireSlot(slot).player.clearVoiceMutes();
  }

  /** `scrubToPercent`'s basis rule, moved here: the percentage is measured against the snapshot's
   *  own position basis, not against a fixed length, and markers are dropped — core's `frames`
   *  and `clamp` live here, not in the service. */
  seekToPercent(slot: Slot, percent: number): Promise<void> {
    const { player } = this.requireSlot(slot);
    const basis = player.getSnapshot().basis.positionBasisFrames;
    return player.seek(frames(Math.round((clamp(percent, 0, 100) / 100) * basis)));
  }

  snapshot(slot: Slot): PlayerSnapshot {
    return this.requireSlot(slot).player.getSnapshot();
  }

  /** Microseconds per play call for this slot's loaded tune — what converts a position in play
   *  calls to time. */
  playCallIntervalUs(slot: Slot): number {
    const { nominalIntervalUs, rate } = this.snapshot(slot).tempo;
    return playCallIntervalUs(nominalIntervalUs, rate);
  }

  position(slot: Slot): Frames {
    return this.requireSlot(slot).player.getPosition();
  }

  /** The loaded tune's note starts, or null until its register record has arrived. */
  noteStarts(slot: Slot): NoteStarts | null {
    return this.noteStartsBySlot.get(slot) ?? null;
  }

  /** Declares the frames this slot may jump to instantly, replacing the previous set; the engine
   *  prepares each off the main thread and publishes readiness in its snapshot. The engine clears
   *  the set on a tune load and a subtune change. */
  setJumpTargets(slot: Slot, targetFrames: readonly number[]): void {
    this.requireSlot(slot).player.setJumpTargets(targetFrames.map((frame) => frames(frame)));
  }

  /** Captures the live position into the engine's image cache and returns its frame, or null with
   *  nothing loaded. A declared frame is ready the moment this returns. */
  capturePosition(slot: Slot): number | null {
    return this.requireSlot(slot).player.capturePosition();
  }

  /** Runs a loop between two frames, holding varispeed inside it when `varispeedStart` is given and
   *  lapping a length that is not a whole number of frames from `lapPhase`; null stops looping. */
  setActiveLoop(slot: Slot, loop: EngineLoop | null): void {
    this.requireSlot(slot).player.setActiveLoop(loop === null ? null : engineLoopOf(loop));
  }

  /** The reduced lap phase of the running loop's lap in progress, or null with no loop running.
   *  Pulled: it moves every lap of a length that is not a whole number of frames. */
  getLapPhase(slot: Slot): number | null {
    return this.requireSlot(slot).player.getLapPhase();
  }

  /** Declares the lines the engine saves the live machine at as the playhead crosses them,
   *  replacing the previous set; `[]` frees them. A saved image is what a loop pushed on a line
   *  starts from. */
  setCrossingCaptures(slot: Slot, lines: readonly CrossingLines[]): void {
    this.requireSlot(slot).player.setCrossingCaptures(lines);
  }

  /** Whether the engine holds an image of the machine at `frame`, from any source. */
  holdsImageAt(slot: Slot, frame: number): boolean {
    return this.requireSlot(slot).player.holdsImageAt(frames(frame));
  }

  /** Names the running loop's replacement for the wrap that ends the lap ending at `frame`, with
   *  `loop` entered from its start's image. False, changing nothing, when no loop is running or no
   *  image of `loop`'s start is held. */
  changeLoopAt(slot: Slot, frame: number, loop: EngineLoop): boolean {
    return this.requireSlot(slot).player.changeLoopAt(frames(frame), engineLoopOf(loop));
  }

  /** Lands the playhead on `at` on the register record, then hands back to the machine. A bare
   *  frame lands with no gate-off pending; a count with `held` lands as it stands, and with its
   *  `lapPhase` as the running loop's lap in progress. False when there is no record, `at` lies
   *  past it, or the deck is not playing. */
  land(
    slot: Slot,
    at: number | { frame: number; held: boolean; lapPhase?: number },
    settings?: JumpSettings
  ): boolean {
    const target =
      typeof at === 'number'
        ? frames(at)
        : {
            frame: frames(at.frame),
            held: at.held,
            ...(at.lapPhase === undefined ? {} : { lapPhase: at.lapPhase }),
          };
    const { player } = this.requireSlot(slot);
    return settings === undefined ? player.land(target) : player.land(target, settings);
  }

  /** Starts, or re-bases, this slot's shadow position: a count that moves a frame a tick wherever
   *  the playhead goes. It laps `loop` (null: wraps where the track does) as the player laps it,
   *  counting from `from` — in the lap its `lapPhase` names, else the loop's lap 0 at its own — or,
   *  with none, from the player's own position, phase and lap. False with no tune loaded. */
  startShadow(
    slot: Slot,
    loop: { startFrame: number; endFrame: number; lapPhase?: number } | null,
    from?: ShadowCount
  ): boolean {
    const { player } = this.requireSlot(slot);
    const lap =
      loop === null
        ? null
        : {
            startFrame: frames(loop.startFrame),
            endFrame: frames(loop.endFrame),
            ...(loop.lapPhase === undefined ? {} : { lapPhase: loop.lapPhase }),
          };
    return from === undefined ? player.startShadow(lap) : player.startShadow(lap, from);
  }

  stopShadow(slot: Slot): void {
    this.requireSlot(slot).player.stopShadow();
  }

  /** The frame the shadow counts now, or null while it is stopped. Pulled for painting; allocates
   *  nothing. */
  getShadowPosition(slot: Slot): Frames | null {
    return this.requireSlot(slot).player.getShadowPosition();
  }

  /** The shadow's exact count, frame and phase, or null while it is stopped. */
  getShadowCount(slot: Slot): ShadowCount | null {
    return this.requireSlot(slot).player.getShadowCount();
  }

  /** Ticks counted since the shadow last started or re-based, or null while it is stopped. */
  getShadowTicks(slot: Slot): number | null {
    return this.requireSlot(slot).player.getShadowTicks();
  }

  /** Lands the playhead on the shadow's count, as `land` does, sending nothing when the deck is
   *  already there. False when there is no record, the count lies past it, the deck is not playing
   *  or the shadow is stopped. The shadow keeps running. */
  landOnShadow(slot: Slot, settings?: JumpSettings): boolean {
    const { player } = this.requireSlot(slot);
    return settings === undefined ? player.landOnShadow() : player.landOnShadow(settings);
  }

  /** Queues a jump for the end of the running loop's lap; null cancels. A loop queued (an
   *  `endFrame`) laps on from the running loop's clock once it lands, so hand-offs never add up
   *  drift; its own `lapPhase` is used only when it takes over from the track's own loop. Its
   *  `settings` land with the jump. */
  queueJump(
    slot: Slot,
    target: {
      startFrame: number;
      endFrame: number | null;
      varispeedStart?: VarispeedLoopStart;
      lapPhase?: number;
      settings?: JumpSettings;
    } | null
  ): void {
    this.requireSlot(slot).player.queueJump(
      target === null
        ? null
        : {
            startFrame: frames(target.startFrame),
            endFrame: target.endFrame === null ? null : frames(target.endFrame),
            ...(target.varispeedStart === undefined
              ? {}
              : { varispeedStart: target.varispeedStart }),
            ...(target.lapPhase === undefined ? {} : { lapPhase: target.lapPhase }),
            ...(target.settings === undefined ? {} : { settings: target.settings }),
          }
    );
  }

  /** Seeks to `frame`; any `settings` land with the jump. */
  seekToFrame(slot: Slot, frame: number, settings?: JumpSettings): Promise<void> {
    const { player } = this.requireSlot(slot);
    return settings === undefined
      ? player.seek(frames(frame))
      : player.seek(frames(frame), settings);
  }

  subscribe(slot: Slot, listener: () => void): () => void {
    return this.requireSlot(slot).player.subscribe(listener);
  }

  identify(slot: Slot, text: string): void {
    this.requireSlot(slot).sink.showText(text);
  }

  /** Puts this slot's player in varispeed, the rate named by `source` once a tick. False, with no
   *  effect, when there is no record yet or the position lies past it. */
  enterVarispeed(slot: Slot, source: VarispeedRateSource): boolean {
    return this.requireSlot(slot).player.enterVarispeed(source);
  }

  /** Takes this slot out of varispeed: a playing deck hands back to live playback, any other is
   *  left paused where the hand stopped. Does nothing outside varispeed. */
  leaveVarispeed(slot: Slot): void {
    this.requireSlot(slot).player.leaveVarispeed();
  }

  /** Disposes this slot's player, which releases both replay threads, and its recorder. Nothing
   *  else holds the clock's audio graph, the ASID session or the threads — a player left running
   *  keeps streaming frames with no UI left to reach `stop()`. */
  dispose(slot: Slot): void {
    const { player, recorder } = this.requireSlot(slot);
    player.dispose();
    recorder.dispose();
  }

  /**
   * The POC's `createOutputPort`, with the output-identity wrap removed: `IMidiAccess.outputPortFor`
   * already memoises on the underlying output's identity, so this façade only needs to re-resolve
   * the id per call, not re-wrap it. Nothing bound drops the bytes and warns once per unbound
   * stretch, not per send — production plays a dropped tune whether or not a port is bound, and a
   * per-call warning would fire fifty times a second.
   *
   * On the sender path a packet goes to the timing helper instead, addressed by the cartridge's
   * token, and only when the helper lists that cartridge; otherwise it is dropped, warning once per
   * stretch. The helper cannot withdraw a frame it holds, so on that path the façade never claims
   * it can cancel.
   */
  private createOutputPort(slot: Slot, facade: FacadeState): MidiOutputPort {
    const resolve = (): MidiOutputPort | null =>
      facade.portId === null ? null : this.midiAccess.outputPortFor(facade.portId);
    const onSender = (): boolean => this.route.path() === 'sender';
    const warnOnce = (why: string): void => {
      if (!facade.warned) {
        facade.warned = true;
        logWarn(`DeckRuntime: slot ${slot} ${why} — dropping bytes.`);
      }
    };
    // Recorded before the port resolves, so a deck with nothing bound still measures its timing.
    const probe = this.probes.get(slot) ?? null;
    const pressProbe = this.pressProbes.get(slot) ?? null;

    return {
      get portId(): string | null {
        return facade.portId;
      },
      get supportsCancel(): boolean {
        return !onSender() && (resolve()?.supportsCancel ?? false);
      },
      send: (bytes: Uint8Array, requestedTimestampMs?: number): void => {
        let timestampMs = requestedTimestampMs;
        if (facade.unstampedOnce) {
          facade.unstampedOnce = false;
          timestampMs = undefined;
        }
        if (probe !== null && timestampMs !== undefined) {
          probe.record(timestampMs);
        }
        pressProbe?.sent(bytes, timestampMs, performance.now());

        if (!onSender()) {
          const resolved = resolve();
          if (resolved === null) {
            warnOnce('has no MIDI port bound');
            return;
          }
          resolved.send(bytes, timestampMs);
          return;
        }

        if (facade.portId === null) {
          warnOnce('has no MIDI port bound');
        } else if (facade.token !== null && this.route.isListedBySender(facade.token)) {
          this.route.sendToSender(facade.token, bytes, timestampMs);
        } else {
          warnOnce('has no cartridge the timing helper lists');
        }
      },
      cancelPending: (): boolean => !onSender() && (resolve()?.cancelPending() ?? false),
    };
  }

  /** The cartridge token in the name of the enumerated port `portId`, or null when the port is not
   *  enumerated or its name carries none. */
  private tokenOfPort(portId: string): string | null {
    const name = this.midiAccess.ports().find((port) => port.id === portId)?.name;
    return name === undefined ? null : midiPortDeviceToken(name);
  }

  private requireSlot(slot: Slot): SlotRuntime {
    const entry = this.slots.get(slot);
    if (entry === undefined) {
      throw new Error(`DeckRuntime: slot ${slot} has not been built`);
    }
    return entry;
  }

  private requireProbe(slot: Slot): DeliveryProbe {
    const probe = this.probes.get(slot);
    if (probe === undefined) {
      throw new Error(`DeckRuntime: slot ${slot} has not been built`);
    }
    return probe;
  }

  private requirePressProbe(slot: Slot): PressProbe {
    const probe = this.pressProbes.get(slot);
    if (probe === undefined) {
      throw new Error(`DeckRuntime: slot ${slot} has not been built`);
    }
    return probe;
  }

  private requireFacade(slot: Slot): FacadeState {
    const facade = this.facades.get(slot);
    if (facade === undefined) {
      throw new Error(`DeckRuntime: slot ${slot} has not been built`);
    }
    return facade;
  }
}
