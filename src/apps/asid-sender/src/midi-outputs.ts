import { teensyRomToken, type SenderToApp } from '@teensyrom-nx/asid-sender-protocol';

export interface MidiOutputLike {
  readonly name: string | null;
  readonly state?: string;
  send(data: Uint8Array): void;
}

/** The part of `MIDIAccess` the sender uses. */
export interface MidiAccessLike {
  outputs(): Iterable<MidiOutputLike>;
  /** Calls `listener` on every `statechange`. */
  onChange(listener: () => void): void;
}

export interface MidiIo {
  requestAccess(): Promise<MidiAccessLike>;
  /** Calls `listener` with the new state whenever the MIDI permission status changes. */
  watchPermission(listener: (state: string) => void): void;
  post(message: SenderToApp): void;
  now(): number;
}

export type SendResult = 'sent' | 'unlisted' | 'failed';

/** A failed send reports itself to the app at most this often per cartridge. */
export const FAULT_EVERY_MS = 1000;

/** Token → output for every output whose name carries a TeensyROM token and that is not disconnected. */
export function teensyRomOutputs<T extends { name: string | null; state?: string }>(
  outputs: Iterable<T>
): Map<string, T> {
  const byToken = new Map<string, T>();
  for (const output of outputs) {
    const token = output.name === null ? null : teensyRomToken(output.name);
    if (token !== null && output.state !== 'disconnected') {
      byToken.set(token, output);
    }
  }
  return byToken;
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * The TeensyROM MIDI outputs, kept current as ports come and go, and the sending to them. Tells the
 * app which cartridges it lists (`outputs`) before it says MIDI is ready, so the app knows the
 * list by the time it moves its decks here.
 */
export class MidiOutputs {
  private access: MidiAccessLike | null = null;
  private outputs = new Map<string, MidiOutputLike>();
  private listed = '';
  private readonly lastFaultMs = new Map<string, number>();

  constructor(private readonly io: MidiIo) {}

  /** Resolves once `outputs` and `ready` have been posted. */
  async start(): Promise<void> {
    let access: MidiAccessLike;
    try {
      access = await this.io.requestAccess();
    } catch (error) {
      this.io.post({ k: 'ready', midi: false, error: describeError(error) });
      return;
    }
    this.access = access;
    this.rebuild();
    access.onChange(() => {
      if (this.rebuild()) {
        this.postOutputs();
      }
    });
    this.io.watchPermission((state) => {
      if (state !== 'granted') {
        this.io.post({ k: 'fault', fault: 'midi-lost', detail: `MIDI permission is ${state}` });
      }
    });
    this.postOutputs();
    this.io.post({ k: 'ready', midi: true });
  }

  lists(token: string): boolean {
    return this.outputs.has(token);
  }

  /** A send that throws counts as failed for that cartridge only; the app hears of it at most once a second. */
  send(token: string, bytes: Uint8Array): SendResult {
    const output = this.outputs.get(token);
    if (!output) {
      return 'unlisted';
    }
    try {
      output.send(bytes);
      return 'sent';
    } catch (error) {
      this.reportFailedSend(token, error);
      return 'failed';
    }
  }

  private reportFailedSend(token: string, error: unknown): void {
    const nowMs = this.io.now();
    const last = this.lastFaultMs.get(token);
    if (last !== undefined && nowMs - last < FAULT_EVERY_MS) {
      return;
    }
    this.lastFaultMs.set(token, nowMs);
    this.io.post({ k: 'fault', fault: 'send-failed', token, detail: describeError(error) });
  }

  /** Returns true when the sorted list of tokens changed. */
  private rebuild(): boolean {
    this.outputs = teensyRomOutputs(this.access?.outputs() ?? []);
    const listed = this.tokens().join(',');
    const changed = listed !== this.listed;
    this.listed = listed;
    return changed;
  }

  private tokens(): string[] {
    return [...this.outputs.keys()].sort();
  }

  private postOutputs(): void {
    this.io.post({ k: 'outputs', tokens: this.tokens() });
  }
}
