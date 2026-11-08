import { InjectionToken } from '@angular/core';
import type { SenderTimingReport } from '@teensyrom-nx/asid-sender-protocol';

export type AsidSenderEvent =
  | { readonly kind: 'tick' } // the link's steady ticker, every 250 ms, connected or not, running with the page hidden
  | { readonly kind: 'loaded' } // the frame fired load (whatever page it loaded)
  | { readonly kind: 'hello'; readonly identity: string; readonly version: number } // the sender's answer to connect, at once
  | { readonly kind: 'ready'; readonly midi: boolean; readonly error?: string } // the sender's MIDI start-up has resolved
  | { readonly kind: 'outputs'; readonly tokens: readonly string[] }
  | { readonly kind: 'pong' }
  | {
      readonly kind: 'fault';
      readonly fault: 'midi-lost' | 'send-failed';
      readonly token?: string;
      readonly detail: string;
    };

export type SelfTestResult = 'passed' | 'failed' | 'aborted';

/**
 * The page's link to the timing helper: the hidden frame that owns its own MIDI access and sends the
 * decks' packets from a thread the mixer's work cannot stall. The application layer decides when to
 * use it; the link only carries events up and packets down.
 */
export interface IAsidSenderLink {
  /** The sender's URL for this page, or null when this address has no other local name. */
  senderUrl(): string | null;
  /** Starts the steady ticker once and sends every event to `listener`; a second call changes nothing. */
  start(listener: (event: AsidSenderEvent) => void): void;
  /** Adds the frame and connects to it, closing any frame already open first. */
  open(): void;
  /** Removes the frame and closes the channel at once; nothing it held can leave afterwards. Idempotent. */
  close(): void;
  /** One packet for the cartridge named by `deviceToken`. `dueAtMs` is on this page's performance.now() clock;
   *  omitted means now. Dropped when no frame is connected. Never transfers or keeps `bytes`. */
  send(deviceToken: string, bytes: Uint8Array, dueAtMs?: number): void;
  /** The own-thread test; `canHold` is asked right before each hold, and false aborts. */
  selfTest(canHold: () => boolean): Promise<SelfTestResult>;
  /** Dev bench: the sender's timing record, or null with no reply in 3 s. */
  readTiming(): Promise<SenderTimingReport | null>;
  /** Dev bench: clears the sender's timing record. */
  clearTiming(): void;
}

export const ASID_SENDER_LINK = new InjectionToken<IAsidSenderLink>('ASID_SENDER_LINK');
