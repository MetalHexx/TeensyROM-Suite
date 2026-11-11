import type { HeldPacket, ReleaseQueue } from './release-queue';
import { WakeAlarms } from './wake-alarms';
import { nextWait, type WakeMargin } from './wake-margin';

/** Messages to the alarm worker. A page's own timers slow to about once a second when it is hidden. */
export type AlarmRequest =
  | { readonly alarm: number | null; readonly delayMs: number }
  | { readonly probe: number; readonly delayMs: number };

/** Messages from the alarm worker. */
export type AlarmReply = { readonly alarm: number } | { readonly probe: number };

/** What the waiter needs from the alarm worker. */
export interface AlarmClock {
  /** Replaces any alarm already armed. */
  arm(id: number, delayMs: number): void;
  disarm(): void;
  probe(seq: number, delayMs: number): void;
}

export interface WaiterEnv {
  now(): number;
  /** Uniform in [0, 1). */
  random(): number;
  readonly alarm: AlarmClock;
  /** Asks for one more turn through the page's own `MessageChannel`; `onTurn` is its delivery. */
  postTurn(): void;
  /** Sends a due packet. `nowMs` is when its send began. Must not throw. */
  release(held: HeldPacket, nowMs: number): void;
  /** A wake-up's lateness, from the alarm (`probe` false) or from the steady check (`probe` true). */
  recordWake(latenessMs: number, nowMs: number, probe: boolean): void;
  /** Sends a due wake. `askedAtMs` is the time it was armed for; `nowMs` is when its send began; both on this page's clock. Must not throw. */
  wake(id: number, askedAtMs: number, nowMs: number): void;
}

/** The steady check's waits are drawn evenly from 20 to 30 ms and must stay under 32 ms: worker
 *  waits of 32 ms and over came back about 13 ms late. */
export const PROBE_MIN_MS = 20;
export const PROBE_MAX_MS = 30;
/** The steady check stops this long after the last packet or wake arming. */
export const PROBE_KEEP_ALIVE_MS = 1000;

type State = 'idle' | 'spin' | 'sleep';

/**
 * Sends packets and wakes when they fall due, never early. Each turn sends everything due in time
 * order (a packet before a wake at the same time), then either goes idle, takes the next turn
 * straight away (spin: the head, the earlier of the next packet and the next wake, is due within
 * the wake margin) or sleeps on the worker's alarm until the margin before the head is due.
 */
export class Waiter {
  private state: State = 'idle';
  private alarmSeq = 0;
  private armedId = 0;
  private armedForMs = 0;
  private askedAtMs = 0;

  private probing = false;
  private probeSeq = 0;
  private probeAskedAtMs = 0;
  private lastActivityMs = -Infinity;

  private readonly alarms = new WakeAlarms();

  constructor(
    private readonly queue: ReleaseQueue,
    private readonly margin: WakeMargin,
    private readonly env: WaiterEnv
  ) {}

  /** Holds a packet (`dueMs` on this page's clock, or null for "now") and makes sure it will be sent on time. */
  submit(token: string, bytes: Uint8Array, dueMs: number | null): void {
    const nowMs = this.env.now();
    this.queue.enqueue(token, bytes, dueMs, nowMs);
    this.noteActivity(nowMs);
  }

  /**
   * Arms a wake for `id` (`atMs` on this page's clock), replacing any armed under it, and makes
   * sure it will be sent on time. False, changing nothing, for a new id when all are in use.
   */
  arm(id: number, atMs: number): boolean {
    if (!this.alarms.set(id, atMs)) {
      return false;
    }
    this.noteActivity(this.env.now());
    return true;
  }

  /** Drops the wake armed under `id`. A sleep armed for it may still wake early and sleep again. */
  cancel(id: number): void {
    this.alarms.delete(id);
  }

  /** The delivery of a turn asked for by `postTurn`. */
  onTurn(): void {
    if (this.state === 'spin') {
      this.turn();
    }
  }

  /** The worker's alarm went off. A stale id is ignored. */
  onAlarm(id: number): void {
    if (this.state !== 'sleep' || id !== this.armedId) {
      return;
    }
    const nowMs = this.env.now();
    this.woke(nowMs - this.askedAtMs, nowMs, false);
    this.turn();
  }

  /** The worker answered a probe. A stale sequence number is ignored. */
  onProbe(seq: number): void {
    if (!this.probing || seq !== this.probeSeq) {
      return;
    }
    const nowMs = this.env.now();
    this.woke(nowMs - this.probeAskedAtMs, nowMs, true);
    if (nowMs - this.lastActivityMs >= PROBE_KEEP_ALIVE_MS) {
      this.probing = false;
    } else {
      this.armProbe();
    }
  }

  private turn(): void {
    this.state = 'idle';
    let nowMs = this.env.now();
    for (;;) {
      const packetAtMs = this.queue.nextAtMs();
      const wakeAtMs = this.alarms.nextAtMs();
      if (
        packetAtMs !== null &&
        packetAtMs <= nowMs &&
        (wakeAtMs === null || packetAtMs <= wakeAtMs)
      ) {
        const held = this.queue.takeDue(nowMs);
        if (held) {
          this.env.release(held, nowMs);
        }
      } else if (wakeAtMs !== null && wakeAtMs <= nowMs) {
        const due = this.alarms.takeDue(nowMs);
        if (due) {
          this.env.wake(due.id, due.atMs, nowMs);
        }
      } else {
        break;
      }
      nowMs = this.env.now();
    }

    const headAtMs = this.headAtMs();
    const wait = nextWait(headAtMs, nowMs, this.margin.marginMs);
    if (wait.kind === 'spin') {
      this.state = 'spin';
      this.env.postTurn();
    } else if (wait.kind === 'sleep' && headAtMs !== null) {
      this.state = 'sleep';
      this.armedForMs = headAtMs;
      this.askedAtMs = nowMs + wait.delayMs;
      this.armedId = ++this.alarmSeq;
      this.env.alarm.arm(this.armedId, wait.delayMs);
    }
  }

  /** A packet or wake was just added: keep the steady check going and bring forward any turn it needs. */
  private noteActivity(nowMs: number): void {
    this.lastActivityMs = nowMs;
    this.startProbing();

    if (this.state === 'idle') {
      this.turn();
    } else if (this.state === 'sleep' && (this.headAtMs() ?? Infinity) < this.armedForMs) {
      this.disarm();
      this.turn();
    }
  }

  /** The earlier of the next packet's and the next wake's time, or null when neither is held. */
  private headAtMs(): number | null {
    const packetAtMs = this.queue.nextAtMs();
    const wakeAtMs = this.alarms.nextAtMs();
    if (packetAtMs === null || (wakeAtMs !== null && wakeAtMs < packetAtMs)) {
      return wakeAtMs;
    }
    return packetAtMs;
  }

  private disarm(): void {
    this.armedId = 0;
    this.env.alarm.disarm();
  }

  private woke(latenessMs: number, nowMs: number, probe: boolean): void {
    this.margin.sample(latenessMs, nowMs);
    this.env.recordWake(latenessMs, nowMs, probe);
  }

  /**
   * A large margin keeps the sender spinning, which means no wake-ups, which would leave the
   * margin nothing to learn from when things improve. So while packets arrive a steady check runs
   * beside the real wake-ups. Its waits are random so it does not lock onto the phase of a coarse
   * system tick.
   */
  private startProbing(): void {
    if (!this.probing) {
      this.probing = true;
      this.armProbe();
    }
  }

  private armProbe(): void {
    const span = PROBE_MAX_MS - PROBE_MIN_MS + 1;
    const delayMs = Math.min(PROBE_MAX_MS, PROBE_MIN_MS + Math.floor(this.env.random() * span));
    this.probeAskedAtMs = this.env.now() + delayMs;
    this.probeSeq++;
    this.env.alarm.probe(this.probeSeq, delayMs);
  }
}
