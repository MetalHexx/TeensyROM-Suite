import { Injectable, inject } from '@angular/core';
import type {
  AsidSenderEvent,
  IAsidSenderLink,
  SelfTestResult,
} from '@teensyrom-nx/application';
import {
  ASID_SENDER_IDENTITY,
  ASID_SENDER_PATH,
  ASID_SENDER_PROTOCOL_VERSION,
  isSenderToApp,
  pairedLocalOrigin,
  toSharedTime,
  type AppToSender,
  type ConnectMessage,
  type SenderTimingReport,
  type SenderToApp,
} from '@teensyrom-nx/asid-sender-protocol';
import { SENDER_PAGE } from './sender-page';

const SELF_TEST_ATTEMPTS = 3;
const SELF_TEST_HOLD_MS = 10;
const SELF_TEST_MIN_TURNS = 3;
const SELF_TEST_REPLY_TIMEOUT_MS = 1000;
const TIMING_REPLY_TIMEOUT_MS = 3000;

interface Connection {
  readonly frame: HTMLIFrameElement;
  readonly port: MessagePort;
  /** True once `connect` has been posted to the frame. */
  connected: boolean;
}

type Settle = (reply: SenderToApp | null) => void;

/**
 * The page's link to the sender frame: the hidden frame on the other local name, the message channel
 * to it, the steady ticker, and the own-thread hold. It carries events up and packets down; the
 * application layer decides when to use it.
 */
@Injectable({ providedIn: 'root' })
export class AsidSenderLinkService implements IAsidSenderLink {
  private readonly page = inject(SENDER_PAGE);

  private listener: ((event: AsidSenderEvent) => void) | null = null;
  private connection: Connection | null = null;
  private pingSeq = 0;
  private requestId = 0;
  private readonly pending = new Map<string, Settle>();

  senderUrl(): string | null {
    const origin = pairedLocalOrigin(this.page.location());
    return origin === null
      ? null
      : `${origin}${ASID_SENDER_PATH}?v=${ASID_SENDER_PROTOCOL_VERSION}`;
  }

  start(listener: (event: AsidSenderEvent) => void): void {
    if (this.listener !== null) {
      return;
    }
    this.listener = listener;
    this.page.startTicker(() => {
      if (this.connection?.connected) {
        this.post({ k: 'ping', seq: ++this.pingSeq });
      }
      this.raise({ kind: 'tick' });
    });
  }

  open(): void {
    this.close();
    const src = this.senderUrl();
    const origin = pairedLocalOrigin(this.page.location());
    if (src === null || origin === null) {
      return;
    }
    const channel = this.page.createChannel();
    const frame = this.page.appendFrame(src);
    const connection: Connection = { frame, port: channel.port1, connected: false };
    this.connection = connection;

    channel.port1.onmessage = (event) => this.receive(event.data);
    frame.addEventListener('load', () => {
      if (this.connection !== connection || connection.connected) {
        return;
      }
      this.raise({ kind: 'loaded' });
      const target = frame.contentWindow;
      if (target === null) {
        return;
      }
      const connect: ConnectMessage = {
        k: 'connect',
        identity: ASID_SENDER_IDENTITY,
        version: ASID_SENDER_PROTOCOL_VERSION,
      };
      target.postMessage(connect, origin, [channel.port2]);
      connection.connected = true;
    });
  }

  close(): void {
    const connection = this.connection;
    if (connection === null) {
      return;
    }
    this.connection = null;
    connection.port.onmessage = null;
    connection.port.close();
    connection.frame.remove();
    const settles = [...this.pending.values()];
    this.pending.clear();
    for (const settle of settles) {
      settle(null);
    }
  }

  send(deviceToken: string, bytes: Uint8Array, dueAtMs?: number): void {
    const connection = this.connection;
    if (connection?.connected !== true) {
      return;
    }
    const due = dueAtMs === undefined ? null : toSharedTime(dueAtMs, this.page.timeOrigin());
    connection.port.postMessage({ k: 'packet', token: deviceToken, bytes, due });
  }

  async selfTest(canHold: () => boolean): Promise<SelfTestResult> {
    for (let attempt = 0; attempt < SELF_TEST_ATTEMPTS; attempt++) {
      if (!canHold()) {
        return 'aborted';
      }
      const id = ++this.requestId;
      const armed = this.request('test-armed', id, SELF_TEST_REPLY_TIMEOUT_MS);
      this.post({ k: 'test-arm', id });
      if ((await armed) === null || !canHold()) {
        return 'aborted';
      }

      const holdStart = this.page.now();
      while (this.page.now() - holdStart < SELF_TEST_HOLD_MS) {
        // Hold this thread: a sender sharing it counts no turns meanwhile.
      }
      const holdEnd = this.page.now();

      const result = this.request('test-result', id, SELF_TEST_REPLY_TIMEOUT_MS);
      const origin = this.page.timeOrigin();
      this.post({
        k: 'test-end',
        id,
        holdStart: toSharedTime(holdStart, origin),
        holdEnd: toSharedTime(holdEnd, origin),
      });
      const reply = await result;
      if (reply === null) {
        return 'aborted';
      }
      if (reply.k === 'test-result' && reply.turns >= SELF_TEST_MIN_TURNS) {
        return 'passed';
      }
    }
    return 'failed';
  }

  async readTiming(): Promise<SenderTimingReport | null> {
    const id = ++this.requestId;
    const reply = this.request('timing', id, TIMING_REPLY_TIMEOUT_MS);
    this.post({ k: 'timing', id });
    const message = await reply;
    return message?.k === 'timing' ? message.report : null;
  }

  clearTiming(): void {
    this.post({ k: 'timing-clear' });
  }

  private post(message: AppToSender): void {
    if (this.connection?.connected === true) {
      this.connection.port.postMessage(message);
    }
  }

  /** Resolves with the reply to request `id` of `kind`, or null on timeout or close. */
  private request(
    kind: SenderToApp['k'],
    id: number,
    timeoutMs: number
  ): Promise<SenderToApp | null> {
    return new Promise((resolve) => {
      const key = `${kind}:${id}`;
      const settle: Settle = (reply) => {
        clearTimeout(timer);
        this.pending.delete(key);
        resolve(reply);
      };
      const timer = setTimeout(() => settle(null), timeoutMs);
      this.pending.set(key, settle);
    });
  }

  private receive(data: unknown): void {
    if (!isSenderToApp(data)) {
      return;
    }
    switch (data.k) {
      case 'hello':
        this.raise({ kind: 'hello', identity: data.identity, version: data.version });
        break;
      case 'ready':
        this.raise(
          data.error === undefined
            ? { kind: 'ready', midi: data.midi }
            : { kind: 'ready', midi: data.midi, error: data.error }
        );
        break;
      case 'outputs':
        this.raise({ kind: 'outputs', tokens: data.tokens });
        break;
      case 'pong':
        this.raise({ kind: 'pong' });
        break;
      case 'fault':
        this.raise(
          data.token === undefined
            ? { kind: 'fault', fault: data.fault, detail: data.detail }
            : { kind: 'fault', fault: data.fault, token: data.token, detail: data.detail }
        );
        break;
      case 'test-armed':
      case 'test-result':
      case 'timing':
        this.pending.get(`${data.k}:${data.id}`)?.(data);
        break;
    }
  }

  private raise(event: AsidSenderEvent): void {
    this.listener?.(event);
  }
}
