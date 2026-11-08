import {
  Injectable,
  Injector,
  Signal,
  effect,
  inject,
  isDevMode,
  runInInjectionContext,
  signal,
  untracked,
} from '@angular/core';
import { ALERT_SERVICE, type IAlertService } from '@teensyrom-nx/domain';
import { logInfo, logWarn, LogType } from '@teensyrom-nx/utils';
import { installSenderBench } from '../bench/sender-bench';
import { DeckRuntime } from '../deck-runtime';
import { ASID_SENDER_LINK, MIDI_ACCESS } from '../ports';
import type { AsidSenderEvent, IMidiAccess } from '../ports';
import { DECK_SLOTS } from '../slot';
import { DeckSendRoute, type SendPath } from './deck-send-route';
import {
  SenderHealth,
  type SenderCommand,
  type SenderHealthEvent,
  type SenderHealthState,
} from './sender-health';

/**
 * Runs the timing helper: feeds the health machine what the link reports and the clock reads, and
 * carries out the machine's commands in the order it gives them. It holds no rules of its own —
 * when the helper may carry the decks' packets, when it has failed, when to retry and what to tell
 * the user all live in `SenderHealth`.
 *
 * With no `ASID_SENDER_LINK` provided there is nothing to supervise: `start` does nothing and the
 * decks keep sending from the mixer.
 */
@Injectable({ providedIn: 'root' })
export class SenderSupervisor {
  private readonly link = inject(ASID_SENDER_LINK, { optional: true });
  private readonly midiAccess: IMidiAccess = inject(MIDI_ACCESS);
  private readonly alertService: IAlertService = inject(ALERT_SERVICE);
  private readonly runtime = inject(DeckRuntime);
  private readonly route = inject(DeckSendRoute);
  private readonly injector = inject(Injector);

  private readonly health = new SenderHealth();
  private readonly healthState = signal<SenderHealthState>('idle');
  private started = false;

  /** Where the machine stands, for the dev bench. */
  readonly state: Signal<SenderHealthState> = this.healthState.asReadonly();

  /**
   * Installed once, in the injector context — `DeckBindings.installEffects`' pattern. The effect
   * feeds the machine `midi-granted` the first time the mixer's MIDI access reads `granted`; until
   * then nothing opens, so an app that is never granted MIDI never loads the helper. Dev builds
   * also get the sender's bench keys and commands.
   */
  start(): void {
    if (this.started || this.link === null) {
      return;
    }
    this.started = true;

    const link = this.link;
    let granted = false;
    runInInjectionContext(this.injector, () => {
      effect(() => {
        if (this.midiAccess.accessState() !== 'granted' || granted) {
          return;
        }
        granted = true;
        untracked(() =>
          this.feed({ kind: 'midi-granted', senderAddress: link.senderUrl() !== null })
        );
      });
    });
    if (isDevMode()) {
      runInInjectionContext(this.injector, () =>
        installSenderBench({ supervisor: this, route: this.route, runtime: this.runtime, link })
      );
    }
  }

  /** The dev flip: the sender if the decks are on the mixer, the mixer if they are on the sender. */
  flip(): void {
    this.feed({ kind: 'prefer', path: this.health.path === 'sender' ? 'mixer' : 'sender' });
  }

  /** The dev break: the failure path a real failure takes, on purpose. */
  breakOnPurpose(): void {
    this.feed({ kind: 'break' });
  }

  private feed(event: SenderHealthEvent): void {
    const commands = this.health.handle(event, performance.now());
    this.healthState.set(this.health.state);
    for (const command of commands) {
      this.carryOut(command);
    }
  }

  private onLinkEvent(event: AsidSenderEvent): void {
    switch (event.kind) {
      case 'tick':
        this.feed({ kind: 'tick', decksPlaying: this.anyDeckPlaying() });
        return;
      case 'outputs':
        this.onOutputs(event.tokens);
        return;
      default:
        this.feed(event);
    }
  }

  /**
   * Replaces the cartridge list in the route. A cartridge newly listed while the decks send through
   * the helper has not heard the start handshake — the helper only just opened it — so a deck
   * bound to it that is playing or paused hears it again, before its next frame.
   */
  private onOutputs(tokens: readonly string[]): void {
    const previous = this.route.setSenderTokens(tokens);
    if (this.route.path() !== 'sender') {
      return;
    }
    for (const slot of DECK_SLOTS) {
      const token = this.runtime.deviceToken(slot);
      if (token === null || previous.has(token) || !this.route.isListedBySender(token)) {
        continue;
      }
      const { transport } = this.runtime.snapshot(slot);
      if (transport === 'playing' || transport === 'paused') {
        this.runtime.resync(slot);
      }
    }
  }

  /** One command at a time, so a command that throws cannot keep the ones after it — above all
   *  the move back to the mixer — from running. */
  private carryOut(command: SenderCommand): void {
    try {
      this.run(command);
    } catch (error) {
      logWarn(
        `SenderSupervisor: ${command.kind} failed — ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private run(command: SenderCommand): void {
    switch (command.kind) {
      case 'start-link':
        this.link?.start((event) => this.onLinkEvent(event));
        return;
      case 'open':
        this.link?.open();
        return;
      case 'close':
        this.link?.close();
        this.route.setSenderTokens([]);
        return;
      case 'route':
        this.routeTo(command.path);
        return;
      case 'self-test':
        this.runSelfTest();
        return;
      case 'alert':
        this.alert(command.alert);
        return;
      case 'log':
        logInfo(LogType.Midi, `ASID sender: ${command.message}`);
        return;
    }
  }

  /** The whole switch in one synchronous step, in this order: the path, then each deck's lookahead
   *  for it, then each playing deck's register image. Frames are only made in the clock's callbacks
   *  on this thread, so none can slip in between a `close` and the new path — and in the other
   *  order a frame the sender still held could leave after today's sending had started, and the
   *  image would be undone by a late frame. */
  private routeTo(path: SendPath): void {
    this.route.setPath(path);
    const lookahead = this.route.lookaheadFor(path);
    for (const slot of DECK_SLOTS) {
      this.runtime.setScheduleAhead(slot, lookahead);
    }
    for (const slot of DECK_SLOTS) {
      this.runtime.sendRegisterImage(slot);
    }
  }

  private runSelfTest(): void {
    this.link
      ?.selfTest(() => !this.anyDeckPlaying())
      .catch((error: unknown) => {
        logWarn(
          `SenderSupervisor: own-thread test failed to run — ${error instanceof Error ? error.message : String(error)}`
        );
        return 'aborted' as const;
      })
      .then((result) => this.feed({ kind: 'self-test', result }));
  }

  private alert(alert: 'down' | 'back' | 'unavailable'): void {
    switch (alert) {
      case 'down':
        this.alertService.warning(
          'Timing helper stopped. Playing with reduced timing while it recovers.'
        );
        return;
      case 'back':
        this.alertService.info('Timing helper is back. Full timing restored.');
        return;
      case 'unavailable':
        this.alertService.warning("Timing helper isn't available here. Playing with standard timing.");
        return;
    }
  }

  private anyDeckPlaying(): boolean {
    return DECK_SLOTS.some((slot) => this.runtime.isPlaying(slot));
  }
}
