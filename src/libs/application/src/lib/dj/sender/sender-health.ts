import {
  ASID_SENDER_IDENTITY,
  ASID_SENDER_PROTOCOL_VERSION,
} from '@teensyrom-nx/asid-sender-protocol';
import type { SelfTestResult } from '../ports';
import type { SendPath } from './deck-send-route';

/** The link's steady ticker. */
export const TICK_MS = 250;
/** A gap between two ticks longer than this means the app's own thread stalled. */
export const STALL_GAP_MS = 400;
/** A sender that has answered no ping for this long, in steady time, has stopped. Judged on
 *  `TICK_MS` ticks, so 750 puts the worst-case noticing just under 1 s. */
export const HEALTH_TIMEOUT_MS = 750;
/** The sender answers `connect` at once; a loaded page that has not by now is not the sender. Under
 *  1 s for the same tick-grid reason as `HEALTH_TIMEOUT_MS`. */
export const HELLO_TIMEOUT_MS = 750;
/** From the sender's `hello` to its MIDI start-up resolving. */
export const MIDI_TIMEOUT_MS = 3000;
/** From `open` to the frame firing `load`. */
export const LOAD_TIMEOUT_MS = 5000;
/** After MIDI is granted, a sender that is not up yet raises no alert. */
export const START_GRACE_MS = 10_000;
/** The wait before each reopen after a failure; the last delay repeats. */
export const RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000, 16000, 30000];

export type SenderHealthEvent =
  | { readonly kind: 'midi-granted'; readonly senderAddress: boolean } // senderAddress = link.senderUrl() !== null
  | { readonly kind: 'tick'; readonly decksPlaying: boolean }
  | { readonly kind: 'loaded' }
  | { readonly kind: 'hello'; readonly identity: string; readonly version: number }
  | { readonly kind: 'ready'; readonly midi: boolean; readonly error?: string }
  | { readonly kind: 'pong' }
  | {
      readonly kind: 'fault';
      readonly fault: 'midi-lost' | 'send-failed';
      readonly detail: string;
    }
  | { readonly kind: 'self-test'; readonly result: SelfTestResult }
  | { readonly kind: 'prefer'; readonly path: SendPath } // the dev flip
  | { readonly kind: 'break' }; // the dev break: the same failure path as a real one

export type SenderCommand =
  | { readonly kind: 'start-link' }
  | { readonly kind: 'open' }
  | { readonly kind: 'close' }
  | { readonly kind: 'route'; readonly path: SendPath }
  | { readonly kind: 'self-test' }
  | { readonly kind: 'alert'; readonly alert: 'down' | 'back' | 'unavailable' }
  | { readonly kind: 'log'; readonly message: string };

/** `parked` is the dev flip: the sender closed on purpose while the decks play on the mixer. */
export type SenderHealthState =
  | 'idle'
  | 'unavailable'
  | 'opening'
  | 'testing'
  | 'up'
  | 'down'
  | 'parked';

/**
 * The rules for when the timing helper may carry the decks' packets: a pure state machine that is
 * handed every event with the time it happened and answers with the commands to carry out, in
 * order. It owns no clock, no timers and no I/O.
 *
 * Every deadline is judged on the link's ticks and only in steady time: a tick gap over
 * `STALL_GAP_MS` means this page's own thread stalled, which restarts the steady count, so a mixer
 * that is busy, hidden or not ticking never makes the sender look dead.
 */
export class SenderHealth {
  private currentState: SenderHealthState = 'idle';
  private currentPath: SendPath = 'mixer';

  private graceEndsAt = 0;
  private lastTickAt: number | null = null;
  private steadySince = Number.NEGATIVE_INFINITY;

  private openedAt = 0;
  private loadedAt: number | null = null;
  private helloAt: number | null = null;
  private lastPongAt = 0;

  private selfTestPassed = false;
  private selfTestPending = false;
  private everUp = false;
  private downAlertShown = false;
  private attempt = 0;
  private retryAt = 0;

  get state(): SenderHealthState {
    return this.currentState;
  }

  /** The path the machine has asked the decks to send on. */
  get path(): SendPath {
    return this.currentPath;
  }

  /** The commands to carry out for `event`, in order. `nowMs` is the time the event happened. */
  handle(event: SenderHealthEvent, nowMs: number): readonly SenderCommand[] {
    if (event.kind === 'prefer') {
      return this.prefer(event.path, nowMs);
    }
    if (event.kind === 'break') {
      return this.isFrameOpen() ? this.fail('broken on purpose', nowMs) : [this.breakIgnored()];
    }

    switch (this.currentState) {
      case 'idle':
        return event.kind === 'midi-granted' ? this.grant(event.senderAddress, nowMs) : [];
      case 'opening':
        return this.whileOpening(event, nowMs);
      case 'testing':
      case 'up':
        return this.whileOpen(event, nowMs);
      case 'down':
        return this.whileDown(event, nowMs);
      case 'parked':
        if (event.kind === 'tick') {
          this.noteTick(nowMs);
        }
        return [];
      case 'unavailable':
        return [];
    }
  }

  private isFrameOpen(): boolean {
    return (
      this.currentState === 'opening' ||
      this.currentState === 'testing' ||
      this.currentState === 'up'
    );
  }

  private grant(senderAddress: boolean, nowMs: number): readonly SenderCommand[] {
    if (!senderAddress) {
      return [
        this.enter('unavailable', 'this address has no other local name'),
        { kind: 'alert', alert: 'unavailable' },
      ];
    }
    this.graceEndsAt = nowMs + START_GRACE_MS;
    this.beginOpening(nowMs);
    return [{ kind: 'start-link' }, { kind: 'open' }, this.enter('opening', 'MIDI granted')];
  }

  private whileOpening(event: SenderHealthEvent, nowMs: number): readonly SenderCommand[] {
    switch (event.kind) {
      case 'tick':
        this.noteTick(nowMs);
        return this.openingDeadlines(nowMs);
      case 'loaded':
        this.loadedAt = nowMs;
        return [];
      case 'hello':
        if (
          event.identity !== ASID_SENDER_IDENTITY ||
          event.version !== ASID_SENDER_PROTOCOL_VERSION
        ) {
          return this.fail(
            `wrong identity or version (${event.identity} v${event.version})`,
            nowMs
          );
        }
        this.helloAt = nowMs;
        this.lastPongAt = nowMs;
        return [];
      case 'pong':
        this.lastPongAt = nowMs;
        return [];
      case 'ready':
        return this.helloAt === null ? [] : this.onReady(event.midi, event.error, nowMs);
      default:
        return [];
    }
  }

  private openingDeadlines(nowMs: number): readonly SenderCommand[] {
    if (this.helloAt !== null) {
      return this.steadyFor(this.helloAt, MIDI_TIMEOUT_MS, nowMs)
        ? this.fail('MIDI did not start', nowMs)
        : [];
    }
    if (this.loadedAt !== null) {
      return this.steadyFor(this.loadedAt, HELLO_TIMEOUT_MS, nowMs)
        ? this.fail('not the sender: the page loaded and never said hello', nowMs)
        : [];
    }
    return this.steadyFor(this.openedAt, LOAD_TIMEOUT_MS, nowMs)
      ? this.fail('did not load', nowMs)
      : [];
  }

  private onReady(
    midi: boolean,
    error: string | undefined,
    nowMs: number
  ): readonly SenderCommand[] {
    if (!midi) {
      return this.fail(`MIDI did not start: ${error ?? 'no reason given'}`, nowMs);
    }
    if (this.selfTestPassed) {
      return this.enterUp('ready');
    }
    this.selfTestPending = false;
    return [this.enter('testing', 'ready; own-thread test next')];
  }

  /** `testing` and `up`: a frame is open and its health is judged the same way. */
  private whileOpen(event: SenderHealthEvent, nowMs: number): readonly SenderCommand[] {
    switch (event.kind) {
      case 'tick': {
        this.noteTick(nowMs);
        if (this.steadyFor(this.lastPongAt, HEALTH_TIMEOUT_MS, nowMs)) {
          return this.fail('stopped answering', nowMs);
        }
        if (this.currentState === 'testing' && !event.decksPlaying && !this.selfTestPending) {
          this.selfTestPending = true;
          return [{ kind: 'self-test' }];
        }
        return [];
      }
      case 'pong':
        this.lastPongAt = nowMs;
        return [];
      case 'fault':
        return event.fault === 'midi-lost'
          ? this.fail(`sender lost MIDI: ${event.detail}`, nowMs)
          : [{ kind: 'log', message: `send failed: ${event.detail}` }];
      case 'self-test':
        return this.currentState === 'testing' ? this.selfTested(event.result) : [];
      default:
        return [];
    }
  }

  private selfTested(result: SelfTestResult): readonly SenderCommand[] {
    this.selfTestPending = false;
    switch (result) {
      case 'passed':
        this.selfTestPassed = true;
        return this.enterUp('own-thread test passed');
      case 'failed':
        return [
          { kind: 'close' },
          this.enter('unavailable', 'own-thread test failed'),
          { kind: 'alert', alert: 'unavailable' },
        ];
      case 'aborted':
        return [];
    }
  }

  private whileDown(event: SenderHealthEvent, nowMs: number): readonly SenderCommand[] {
    if (event.kind !== 'tick') {
      return [];
    }
    this.noteTick(nowMs);
    const commands: SenderCommand[] = [];
    if (!this.downAlertShown && !this.everUp && nowMs >= this.graceEndsAt) {
      this.downAlertShown = true;
      commands.push({ kind: 'alert', alert: 'down' });
    }
    if (nowMs >= this.retryAt) {
      this.beginOpening(nowMs);
      commands.push({ kind: 'open' }, this.enter('opening', 'retrying'));
    }
    return commands;
  }

  private prefer(path: SendPath, nowMs: number): readonly SenderCommand[] {
    if (this.currentState === 'up' && path === 'mixer') {
      this.currentPath = 'mixer';
      return [
        { kind: 'close' },
        { kind: 'route', path: 'mixer' },
        this.enter('parked', 'dev flip to the mixer'),
      ];
    }
    if (this.currentState === 'parked' && path === 'sender') {
      this.beginOpening(nowMs);
      return [{ kind: 'open' }, this.enter('opening', 'dev flip to the sender')];
    }
    const why =
      this.currentState === 'up' || this.currentState === 'parked'
        ? `already on the ${this.currentPath}`
        : `the sender is not up (${this.currentState})`;
    return [{ kind: 'log', message: `dev flip to the ${path} ignored: ${why}` }];
  }

  private breakIgnored(): SenderCommand {
    return {
      kind: 'log',
      message: `dev break ignored: no sender frame is open (${this.currentState})`,
    };
  }

  /** Closes the frame, puts the decks back on the mixer when they were on the sender, logs why, and
   *  schedules the retry — in that order. The down alert comes last, and only once and past the
   *  grace period. */
  private fail(reason: string, nowMs: number): readonly SenderCommand[] {
    const commands: SenderCommand[] = [{ kind: 'close' }];
    if (this.currentPath === 'sender') {
      this.currentPath = 'mixer';
      commands.push({ kind: 'route', path: 'mixer' });
    }
    commands.push(this.enter('down', reason));
    if (!this.downAlertShown && nowMs >= this.graceEndsAt) {
      this.downAlertShown = true;
      commands.push({ kind: 'alert', alert: 'down' });
    }
    this.selfTestPending = false;
    this.retryAt = nowMs + RETRY_DELAYS_MS[Math.min(this.attempt, RETRY_DELAYS_MS.length - 1)];
    this.attempt++;
    return commands;
  }

  private enterUp(reason: string): readonly SenderCommand[] {
    this.currentPath = 'sender';
    this.attempt = 0;
    this.everUp = true;
    const commands: SenderCommand[] = [
      { kind: 'route', path: 'sender' },
      this.enter('up', reason),
    ];
    if (this.downAlertShown) {
      this.downAlertShown = false;
      commands.push({ kind: 'alert', alert: 'back' });
    }
    return commands;
  }

  private beginOpening(nowMs: number): void {
    this.openedAt = nowMs;
    this.loadedAt = null;
    this.helloAt = null;
  }

  /** Moves to `next` and returns the log line that records it. */
  private enter(next: SenderHealthState, reason: string): SenderCommand {
    const message = `${this.currentState} -> ${next}: ${reason}`;
    this.currentState = next;
    return { kind: 'log', message };
  }

  /** Measures the gap since the last tick; a gap over `STALL_GAP_MS` restarts the steady count. */
  private noteTick(nowMs: number): void {
    if (this.lastTickAt !== null && nowMs - this.lastTickAt > STALL_GAP_MS) {
      this.steadySince = nowMs;
    }
    this.lastTickAt = nowMs;
  }

  /** True once `deadlineMs` has passed since `sinceMs` and the page has also been steady that long. */
  private steadyFor(sinceMs: number, deadlineMs: number, nowMs: number): boolean {
    return nowMs - sinceMs >= deadlineMs && nowMs - this.steadySince >= deadlineMs;
  }
}
