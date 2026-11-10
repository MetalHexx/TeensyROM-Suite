import { signal, type WritableSignal } from '@angular/core';
import { vi } from 'vitest';
import { FakeClock } from '@sidablist/core';
import type { RegisterRecord, ReplayRunner } from '@sidablist/core';
import type { MidiOutputPort } from '@sidablist/asid';
import type { Playable } from '@sidablist/tunes';
import type { IMidiAccess, MidiAccessState, MidiPermission, MidiPortOption } from '../ports/midi-access';
import type {
  AsidSenderEvent,
  DeckFrameClock,
  IAsidSenderLink,
  RegisterRecorder,
  SelfTestResult,
  SenderWakeAlarm,
  TickSource,
  WakeReadings,
} from '../ports';
import type { SenderTimingReport } from '@teensyrom-nx/asid-sender-protocol';

/** Only `dispose()` is exercised in most specs, so `run` is never expected to be called. */
export class FakeReplayRunner implements ReplayRunner {
  disposed = false;
  run = vi.fn();
  dispose(): void {
    this.disposed = true;
  }
}

const NO_LATENESS = { count: 0, p50: 0, p99: 0, max: 0 };
const NO_WAKES: WakeReadings = {
  wakes: 0,
  early: 0,
  guardRearms: 0,
  senderLateMs: NO_LATENESS,
  mixerLateMs: NO_LATENESS,
};

/** A `FakeClock` that also keeps the tick source it was handed, and reads the wakes a spec sets. */
export class FakeDeckClock extends FakeClock implements DeckFrameClock {
  source: TickSource = 'audio';
  wakeResets = 0;
  wakes: WakeReadings = NO_WAKES;

  setSource(source: TickSource): void {
    this.source = source;
  }

  wakeReadings(): WakeReadings {
    return this.wakes;
  }

  resetWakeReadings(): void {
    this.wakeResets++;
  }
}

/** A recorder whose scans the spec settles by hand. */
export class FakeRegisterRecorder implements RegisterRecorder {
  disposed = false;
  readonly requests: {
    readonly bytes: Uint8Array;
    readonly subtune: number;
    readonly frames: number;
  }[] = [];
  private readonly settlers: {
    resolve: (record: RegisterRecord | null) => void;
    reject: (error: unknown) => void;
  }[] = [];

  record(bytes: Uint8Array, subtune: number, frames: number): Promise<RegisterRecord | null> {
    this.requests.push({ bytes, subtune, frames });
    return new Promise((resolve, reject) => this.settlers.push({ resolve, reject }));
  }

  dispose(): void {
    this.disposed = true;
  }

  /** Answers the `index`th request. */
  answer(index: number, record: RegisterRecord | null): void {
    this.settlers[index].resolve(record);
  }

  fail(index: number, error: unknown): void {
    this.settlers[index].reject(error);
  }
}

export function recordOf(frames: number): RegisterRecord {
  return {
    frames,
    values: new Uint8Array(frames * 25),
    retriggerEntries: new Uint32Array(0),
    retriggerRegisters: new Uint8Array(0),
    retriggerValues: new Uint8Array(0),
  };
}

export interface RecordingPort extends MidiOutputPort {
  readonly sent: readonly Uint8Array[];
  /** The stamp each packet in `sent` carried, `undefined` for one sent unstamped. */
  readonly stamps: readonly (number | undefined)[];
}

/** A port that records every packet and the stamp it carried; it cannot cancel unless told it can.
 *  Every send also lands in `timeline` as `mixer:send`, to be read against other fakes' entries. */
export function recordingPort(
  portId: string,
  options: { readonly supportsCancel?: boolean; readonly timeline?: string[] } = {}
): RecordingPort {
  const { supportsCancel = false, timeline } = options;
  const sent: Uint8Array[] = [];
  const stamps: (number | undefined)[] = [];
  return {
    portId,
    supportsCancel,
    send: (bytes: Uint8Array, timestampMs?: number): void => {
      sent.push(bytes);
      stamps.push(timestampMs);
      timeline?.push('mixer:send');
    },
    cancelPending: (): boolean => supportsCancel,
    sent,
    stamps,
  };
}

export interface FakeMidiAccess extends IMidiAccess {
  readonly accessState: WritableSignal<MidiAccessState>;
  readonly ports: WritableSignal<readonly MidiPortOption[]>;
}

export function fakeMidiAccess(
  outputPortFor: (id: string) => MidiOutputPort | null,
  ports: readonly MidiPortOption[] = []
): FakeMidiAccess {
  return {
    accessState: signal<MidiAccessState>('granted'),
    ports: signal<readonly MidiPortOption[]>(ports),
    lastError: signal<string | null>(null),
    queryPermission: (): Promise<MidiPermission> => Promise.resolve('granted'),
    requestAccess: (): Promise<void> => Promise.resolve(),
    holderOf: (): string | null => null,
    claim: (): boolean => true,
    release: (): void => undefined,
    outputPortFor,
  };
}

const PSID_HEADER_SIZE = 0x7c;
export const SID_MODEL_6581 = 0b01;
export const SID_MODEL_8580 = 0b10;

/** `LDA #0; RTS`: a tune that loads and does nothing audible. */
const IDLE_TUNE = [0xa9, 0x00, 0x60];

/** Init is an `RTS` at $1000; play, at $1003, counts up in $1020 and writes the count to a SID
 *  register, so every frame it runs has a write to deliver. */
export const WRITING_TUNE = [
  0x60, 0xea, 0xea, 0xee, 0x20, 0x10, 0xad, 0x20, 0x10, 0x8d, 0x18, 0xd4, 0x60,
];

/** A minimal well-formed PSID v2 file whose header names the given SID model. */
export function sidBytes(model: number, payload: readonly number[] = IDLE_TUNE): Uint8Array {
  const buffer = new Uint8Array(PSID_HEADER_SIZE + payload.length);
  const view = new DataView(buffer.buffer);
  buffer.set([0x50, 0x53, 0x49, 0x44], 0x00); // 'PSID'
  view.setUint16(0x04, 2, false);
  view.setUint16(0x06, PSID_HEADER_SIZE, false);
  view.setUint16(0x08, 0x1000, false);
  view.setUint16(0x0a, 0x1000, false);
  view.setUint16(0x0c, 0x1003, false);
  view.setUint16(0x0e, 1, false);
  view.setUint16(0x10, 1, false);
  view.setUint16(0x76, model << 4, false);
  buffer.set(payload, PSID_HEADER_SIZE);
  return buffer;
}

export function playableOf(model: number, payload?: readonly number[]): Playable {
  return {
    bytes: sidBytes(model, payload),
    reference: { identity: { sidHash: 'tune', subtune: 1 } },
    index: { loopStartFrame: null, loopPeriodFrames: null, endedAtFrame: null },
  } as unknown as Playable;
}

/** A link that records what the application asks of it and lets a spec raise the helper's events.
 *  Every call also lands in `timeline` (`link:open`, `link:close`, `link:send`, …). */
export class FakeSenderLink implements IAsidSenderLink {
  url: string | null = 'http://helper.localhost/';
  readonly sends: { token: string; bytes: Uint8Array; dueAtMs: number | undefined }[] = [];
  readonly canHold: (() => boolean)[] = [];
  starts = 0;
  opens = 0;
  closes = 0;
  timing: SenderTimingReport | null = null;
  timingClears = 0;
  private listener: ((event: AsidSenderEvent) => void) | null = null;
  private selfTestSettlers: ((result: SelfTestResult) => void)[] = [];

  constructor(readonly timeline: string[] = []) {}

  senderUrl(): string | null {
    return this.url;
  }

  start(listener: (event: AsidSenderEvent) => void): void {
    this.starts++;
    this.listener = listener;
    this.timeline.push('link:start');
  }

  open(): void {
    this.opens++;
    this.timeline.push('link:open');
  }

  close(): void {
    this.closes++;
    this.timeline.push('link:close');
  }

  send(token: string, bytes: Uint8Array, dueAtMs?: number): void {
    this.sends.push({ token, bytes, dueAtMs });
    this.timeline.push('link:send');
  }

  selfTest(canHold: () => boolean): Promise<SelfTestResult> {
    this.canHold.push(canHold);
    this.timeline.push('link:self-test');
    return new Promise((resolve) => this.selfTestSettlers.push(resolve));
  }

  readTiming(): Promise<SenderTimingReport | null> {
    return Promise.resolve(this.timing);
  }

  clearTiming(): void {
    this.timingClears++;
  }

  wakeAlarm(): SenderWakeAlarm {
    return { arm: (): void => undefined, cancel: (): void => undefined };
  }

  /** Raises an event as the helper's frame would. */
  emit(event: AsidSenderEvent): void {
    this.listener?.(event);
  }

  /** Settles the oldest own-thread test still waiting. */
  settleSelfTest(result: SelfTestResult): void {
    this.selfTestSettlers.shift()?.(result);
  }
}
