import {
  ASID_SENDER_IDENTITY,
  ASID_SENDER_PROTOCOL_VERSION,
  fromSharedTime,
  isAppToSender,
  isTeensyRomToken,
  type SenderToApp,
} from '@teensyrom-nx/asid-sender-protocol';
import { MidiOutputs, type MidiAccessLike } from './midi-outputs';
import { ReleaseQueue } from './release-queue';
import { SelfTest } from './self-test';
import { TimingRecord } from './timing-record';
import { Waiter, type AlarmClock } from './waiter';
import { WakeMargin } from './wake-margin';

export interface SessionDeps {
  /** The connected channel's port. */
  readonly port: { postMessage(message: SenderToApp): void };
  now(): number;
  readonly timeOrigin: number;
  /** Uniform in [0, 1). */
  random(): number;
  readonly alarm: AlarmClock;
  /** One more turn through the page's own `MessageChannel`; its delivery is `onTurn`. */
  postTurn(): void;
  /** One more self-test turn through the page's own `MessageChannel`; its delivery is `onTick`. */
  postTick(): void;
  requestMidiAccess(): Promise<MidiAccessLike>;
  watchMidiPermission(listener: (state: string) => void): void;
  visibility(): 'visible' | 'hidden';
}

/**
 * One connection from the app: answers its messages, holds and sends its packets on time, and keeps
 * the sender's own timing record. The page feeds it what it hears: the app's messages
 * (`onMessage`), turns, the alarm worker's replies and visibility changes.
 */
export class Session {
  private readonly queue = new ReleaseQueue();
  private readonly margin = new WakeMargin();
  private readonly timing: TimingRecord;
  private readonly midi: MidiOutputs;
  private readonly waiter: Waiter;
  private readonly selfTest: SelfTest;

  constructor(private readonly deps: SessionDeps) {
    const { port } = deps;
    this.timing = new TimingRecord(deps.now(), deps.visibility(), this.margin.marginMs);
    this.midi = new MidiOutputs({
      requestAccess: () => deps.requestMidiAccess(),
      watchPermission: (listener) => deps.watchMidiPermission(listener),
      post: (message) => port.postMessage(message),
      now: () => deps.now(),
    });
    this.waiter = new Waiter(this.queue, this.margin, {
      now: () => deps.now(),
      random: () => deps.random(),
      alarm: deps.alarm,
      postTurn: () => deps.postTurn(),
      release: (held, nowMs) => {
        const result = this.midi.send(held.token, held.bytes);
        if (result === 'sent') {
          this.timing.sent(held.token, held, nowMs);
        } else if (result === 'failed') {
          this.timing.failedSend(held.token, nowMs);
        } else {
          this.timing.dropped(held.token, nowMs);
        }
      },
      recordWake: (latenessMs, nowMs, probe) => {
        this.timing.wake(latenessMs, nowMs, probe);
        this.timing.margin(this.margin.marginMs);
      },
    });
    this.selfTest = new SelfTest({
      now: () => deps.now(),
      timeOrigin: deps.timeOrigin,
      postTick: () => deps.postTick(),
    });
  }

  /** Says hello at once, then starts MIDI; resolves when MIDI has said `ready`. */
  start(): Promise<void> {
    this.post({
      k: 'hello',
      identity: ASID_SENDER_IDENTITY,
      version: ASID_SENDER_PROTOCOL_VERSION,
    });
    return this.midi.start();
  }

  onMessage(data: unknown): void {
    if (!isAppToSender(data)) {
      this.dropInvalid(data);
      return;
    }
    switch (data.k) {
      case 'packet':
        this.onPacket(data.token, data.bytes, data.due);
        break;
      case 'ping':
        this.post({ k: 'pong', seq: data.seq });
        this.timing.ping(this.deps.now());
        break;
      case 'test-arm':
        this.selfTest.arm();
        this.post({ k: 'test-armed', id: data.id });
        break;
      case 'test-end':
        this.post({
          k: 'test-result',
          id: data.id,
          turns: this.selfTest.end(data.holdStart, data.holdEnd),
        });
        break;
      case 'timing':
        this.post({ k: 'timing', id: data.id, report: this.timing.report(this.deps.now()) });
        break;
      case 'timing-clear':
        this.timing.clear(this.deps.now());
        break;
    }
  }

  onTurn(): void {
    this.waiter.onTurn();
  }

  onTick(): void {
    this.selfTest.onTick();
  }

  onAlarm(id: number): void {
    this.waiter.onAlarm(id);
  }

  onProbe(seq: number): void {
    this.waiter.onProbe(seq);
  }

  onVisibility(state: 'visible' | 'hidden'): void {
    this.timing.visibilityChanged(state, this.deps.now());
  }

  private onPacket(token: string, bytes: Uint8Array, due: number | null): void {
    if (!this.midi.lists(token)) {
      this.timing.dropped(token, this.deps.now());
      return;
    }
    this.waiter.submit(
      token,
      bytes,
      due === null ? null : fromSharedTime(due, this.deps.timeOrigin)
    );
  }

  /** An invalid packet is counted against its cartridge when it names one; anything else is ignored. */
  private dropInvalid(data: unknown): void {
    if (typeof data !== 'object' || data === null) {
      return;
    }
    const { k, token } = data as { k?: unknown; token?: unknown };
    if (k === 'packet' && isTeensyRomToken(token)) {
      this.timing.dropped(token, this.deps.now());
    }
  }

  private post(message: SenderToApp): void {
    this.deps.port.postMessage(message);
  }
}
