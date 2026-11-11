import { describe, it, expect, afterEach, vi } from 'vitest';
import { NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AsidSenderEvent } from '@teensyrom-nx/application';
import {
  ASID_SENDER_IDENTITY,
  ASID_SENDER_PROTOCOL_VERSION,
  MAX_WAKE_ALARMS,
  type AppToSender,
} from '@teensyrom-nx/asid-sender-protocol';
import { AsidSenderLinkService } from './asid-sender-link.service';
import { SENDER_PAGE, type SenderPage } from './sender-page';

const TIME_ORIGIN = 1_000_000;
const SENDER_ORIGIN = '127.0.0.1';
const PACKET = new Uint8Array([0xf0, 0x7d, 0xf7]);

interface FakeSetup {
  readonly service: AsidSenderLinkService;
  readonly zone: NgZone;
  readonly events: AsidSenderEvent[];
  readonly frames: FakeFrame[];
  readonly ports: FakePort[];
  tick(): void;
  /** Plays the sender's side: a message arriving on the app's port. */
  fromSender(data: unknown): void;
  /** The messages the app has posted on its port, in order. */
  sent(): AppToSender[];
  loadFrame(): void;
}

class FakePort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly postMessage = vi.fn<(message: AppToSender) => void>();
  readonly close = vi.fn();
}

class FakeFrame {
  readonly contentWindow = { postMessage: vi.fn() };
  readonly remove = vi.fn();
  private loadHandler: (() => void) | null = null;
  constructor(readonly src: string) {}
  addEventListener(type: string, handler: () => void): void {
    if (type === 'load') {
      this.loadHandler = handler;
    }
  }
  load(): void {
    this.loadHandler?.();
  }
}

function setup(hostname = 'localhost'): FakeSetup {
  const frames: FakeFrame[] = [];
  const ports: FakePort[] = [];
  const port2s: object[] = [];
  let onTick: (() => void) | null = null;
  let clock = 0;

  const page: SenderPage = {
    appendFrame: (src) => {
      const frame = new FakeFrame(src);
      frames.push(frame);
      return frame as unknown as HTMLIFrameElement;
    },
    createChannel: () => {
      const port1 = new FakePort();
      const port2 = {};
      ports.push(port1);
      port2s.push(port2);
      return { port1, port2 } as unknown as MessageChannel;
    },
    startTicker: (tick) => {
      onTick = tick;
    },
    now: () => clock++,
    timeOrigin: () => TIME_ORIGIN,
    location: () => ({ protocol: 'http:', hostname, port: '4200' }),
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: SENDER_PAGE, useValue: page }] });
  const service = TestBed.inject(AsidSenderLinkService);
  const events: AsidSenderEvent[] = [];
  service.start((event) => events.push(event));

  const lastPort = () => ports[ports.length - 1];
  return {
    service,
    zone: TestBed.inject(NgZone),
    events,
    frames,
    ports,
    tick: () => onTick?.(),
    fromSender: (data) => lastPort().onmessage?.({ data }),
    sent: () => lastPort().postMessage.mock.calls.map(([message]) => message),
    loadFrame: () => frames[frames.length - 1].load(),
  };
}

/** A fake sender that answers the own-thread test with `turns` and every arm at once. */
function answerSelfTest(env: FakeSetup, turns: () => number): void {
  const port = env.ports[env.ports.length - 1];
  port.postMessage.mockImplementation((message) => {
    if (message.k === 'test-arm') {
      queueMicrotask(() => env.fromSender({ k: 'test-armed', id: message.id }));
    } else if (message.k === 'test-end') {
      queueMicrotask(() => env.fromSender({ k: 'test-result', id: message.id, turns: turns() }));
    }
  });
}

describe('AsidSenderLinkService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('senderUrl', () => {
    it('names the other local name, with the protocol version in the query', () => {
      const { service } = setup('localhost');

      expect(service.senderUrl()).toBe(
        `http://127.0.0.1:4200/asid-sender/index.html?v=${ASID_SENDER_PROTOCOL_VERSION}`
      );
    });

    it('is null on a host with no other local name, and open adds no frame', () => {
      const env = setup('example.com');

      env.service.open();

      expect(env.service.senderUrl()).toBeNull();
      expect(env.frames).toHaveLength(0);
    });
  });

  describe('open', () => {
    it('connects once on load, to the exact sender origin, transferring port2', () => {
      const env = setup();
      env.service.open();

      env.loadFrame();
      env.loadFrame();

      const post = env.frames[0].contentWindow.postMessage;
      expect(post).toHaveBeenCalledTimes(1);
      const [message, targetOrigin, transfer] = post.mock.calls[0];
      expect(message).toEqual({
        k: 'connect',
        identity: ASID_SENDER_IDENTITY,
        version: ASID_SENDER_PROTOCOL_VERSION,
      });
      expect(targetOrigin).toBe(`http://${SENDER_ORIGIN}:4200`);
      expect(transfer).toHaveLength(1);
      expect(env.events).toContainEqual({ kind: 'loaded' });
    });

    it('closes the frame it had open before opening another', () => {
      const env = setup();
      env.service.open();

      env.service.open();

      expect(env.frames).toHaveLength(2);
      expect(env.frames[0].remove).toHaveBeenCalled();
      expect(env.ports[0].close).toHaveBeenCalled();
    });

    it('turns sender messages into events in arrival order and ignores malformed ones', () => {
      const env = setup();
      env.service.open();
      env.loadFrame();
      env.events.length = 0;

      env.fromSender({ k: 'hello', identity: ASID_SENDER_IDENTITY, version: 1 });
      env.fromSender({ k: 'nonsense' });
      env.fromSender('garbage');
      env.fromSender({ k: 'outputs', tokens: ['12345'] });
      env.fromSender({ k: 'outputs', tokens: ['bad token!'] });
      env.fromSender({ k: 'ready', midi: false, error: 'denied' });
      env.fromSender({ k: 'pong', seq: 1 });
      env.fromSender({ k: 'fault', fault: 'send-failed', token: '12345', detail: 'boom' });

      expect(env.events).toEqual([
        { kind: 'hello', identity: ASID_SENDER_IDENTITY, version: 1 },
        { kind: 'outputs', tokens: ['12345'] },
        { kind: 'ready', midi: false, error: 'denied' },
        { kind: 'pong' },
        { kind: 'fault', fault: 'send-failed', token: '12345', detail: 'boom' },
      ]);
    });
  });

  describe('ticker', () => {
    it('raises tick on every beat, and pings only while connected', () => {
      const env = setup();

      env.tick();
      env.service.open();
      env.tick();
      env.loadFrame();
      env.tick();
      env.tick();

      expect(env.events.filter((event) => event.kind === 'tick')).toHaveLength(4);
      expect(env.sent()).toEqual([
        { k: 'ping', seq: 1 },
        { k: 'ping', seq: 2 },
      ]);
    });

    it('sends the ping before it raises the tick', () => {
      const env = setup();
      env.service.open();
      env.loadFrame();
      const order: string[] = [];
      env.ports[0].postMessage.mockImplementation(() => order.push('ping'));
      env.events.push = (...items: AsidSenderEvent[]) => {
        order.push(...items.map((item) => item.kind));
        return order.length;
      };

      env.tick();

      expect(order).toEqual(['ping', 'tick']);
    });
  });

  describe('send', () => {
    it('stamps due on the shared clock, or null when omitted, and leaves the buffer readable', () => {
      const env = setup();
      env.service.open();
      env.loadFrame();
      const bytes = new Uint8Array(PACKET);

      env.service.send('12345', bytes, 250);
      env.service.send('12345', bytes);

      expect(env.sent()).toEqual([
        { k: 'packet', token: '12345', bytes: PACKET, due: TIME_ORIGIN + 250 },
        { k: 'packet', token: '12345', bytes: PACKET, due: null },
      ]);
      expect(env.ports[0].postMessage.mock.calls[0]).toHaveLength(1);
      expect(Array.from(bytes)).toEqual(Array.from(PACKET));
    });

    it('is dropped before a frame is connected', () => {
      const env = setup();
      env.service.open();

      env.service.send('12345', PACKET);

      expect(env.ports[0].postMessage).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('removes the frame, closes the port, drops later sends, and is idempotent', () => {
      const env = setup();
      env.service.open();
      env.loadFrame();

      env.service.close();
      env.service.close();
      env.service.send('12345', PACKET);

      expect(env.frames[0].remove).toHaveBeenCalledTimes(1);
      expect(env.ports[0].close).toHaveBeenCalledTimes(1);
      expect(env.ports[0].onmessage).toBeNull();
      expect(env.ports[0].postMessage).not.toHaveBeenCalled();
    });

    it('settles pending selfTest as aborted and pending readTiming as null', async () => {
      const env = setup();
      env.service.open();
      env.loadFrame();

      const selfTest = env.service.selfTest(() => true);
      const timing = env.service.readTiming();
      env.service.close();

      await expect(selfTest).resolves.toBe('aborted');
      await expect(timing).resolves.toBeNull();
    });
  });

  describe('selfTest', () => {
    it('passes against a sender that keeps counting, with the hold on the shared clock', async () => {
      const env = setup();
      env.service.open();
      env.loadFrame();
      answerSelfTest(env, () => 40);

      await expect(env.service.selfTest(() => true)).resolves.toBe('passed');

      const end = env.sent().find((message) => message.k === 'test-end');
      expect(end).toMatchObject({ k: 'test-end' });
      if (end?.k === 'test-end') {
        expect(end.holdEnd - end.holdStart).toBeGreaterThanOrEqual(10);
        expect(end.holdStart).toBeGreaterThanOrEqual(TIME_ORIGIN);
      }
    });

    it('fails after three holds against a sender that counts nothing', async () => {
      const env = setup();
      env.service.open();
      env.loadFrame();
      answerSelfTest(env, () => 0);

      await expect(env.service.selfTest(() => true)).resolves.toBe('failed');

      expect(env.sent().filter((message) => message.k === 'test-end')).toHaveLength(3);
    });

    it('passes on a retry after a paused attempt', async () => {
      const env = setup();
      env.service.open();
      env.loadFrame();
      const counts = [0, 50];
      answerSelfTest(env, () => counts.shift() ?? 50);

      await expect(env.service.selfTest(() => true)).resolves.toBe('passed');
    });

    it('aborts, holding nothing, when canHold is false', async () => {
      const env = setup();
      env.service.open();
      env.loadFrame();

      await expect(env.service.selfTest(() => false)).resolves.toBe('aborted');

      expect(env.ports[0].postMessage).not.toHaveBeenCalled();
    });

    it('aborts without holding when a deck starts playing while the arm is in flight', async () => {
      const env = setup();
      env.service.open();
      env.loadFrame();
      answerSelfTest(env, () => 40);
      const answers = [true, false];

      await expect(env.service.selfTest(() => answers.shift() ?? false)).resolves.toBe('aborted');

      expect(env.sent().map((message) => message.k)).toEqual(['test-arm']);
    });

    it('aborts when the sender never answers the arm', async () => {
      vi.useFakeTimers();
      const env = setup();
      env.service.open();
      env.loadFrame();

      const result = env.service.selfTest(() => true);
      await vi.advanceTimersByTimeAsync(1000);

      await expect(result).resolves.toBe('aborted');
    });
  });

  describe('readTiming', () => {
    it('returns null after 3 s with no reply', async () => {
      vi.useFakeTimers();
      const env = setup();
      env.service.open();
      env.loadFrame();

      const result = env.service.readTiming();
      await vi.advanceTimersByTimeAsync(3000);

      await expect(result).resolves.toBeNull();
    });

    it('clearTiming posts timing-clear', () => {
      const env = setup();
      env.service.open();
      env.loadFrame();

      env.service.clearTiming();

      expect(env.sent()).toEqual([{ k: 'timing-clear' }]);
    });
  });
  describe('wakeAlarm', () => {
    const noop = (): void => undefined;

    it('posts an arm on the shared clock under an id that runs from 1, and a cancel under the same id', () => {
      const env = setup();
      env.service.open();
      env.loadFrame();

      const first = env.service.wakeAlarm(noop, noop);
      const second = env.service.wakeAlarm(noop, noop);
      first.arm(250);
      second.arm(300);
      first.cancel();

      expect(env.sent()).toEqual([
        { k: 'wake-at', id: 1, at: TIME_ORIGIN + 250 },
        { k: 'wake-at', id: 2, at: TIME_ORIGIN + 300 },
        { k: 'wake-cancel', id: 1 },
      ]);
    });

    it('hands a wake to its own handler with both times on this page clock and this page now, ignoring an unknown id', () => {
      const env = setup();
      env.service.open();
      env.loadFrame();
      const onWake = vi.fn();
      const other = vi.fn();
      env.service.wakeAlarm(onWake, noop);
      env.service.wakeAlarm(other, noop);

      env.fromSender({ k: 'wake', id: 1, at: TIME_ORIGIN + 100, t: TIME_ORIGIN + 100.25 });
      env.fromSender({ k: 'wake', id: 99, at: TIME_ORIGIN + 100, t: TIME_ORIGIN + 100.25 });

      expect(onWake).toHaveBeenCalledExactlyOnceWith(100, 100.25, expect.any(Number));
      expect(other).not.toHaveBeenCalled();
      expect(env.events.filter((event) => event.kind !== 'loaded')).toEqual([]);
    });

    it('throws a RangeError for an alarm past the most the sender holds', () => {
      const env = setup();

      for (let i = 0; i < MAX_WAKE_ALARMS; i++) {
        env.service.wakeAlarm(noop, noop);
      }

      expect(() => env.service.wakeAlarm(noop, noop)).toThrow(RangeError);
    });

    it('drops arms and cancels with no frame connected, logging the drop once per stretch', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const env = setup();
      env.service.open();
      const alarm = env.service.wakeAlarm(noop, noop);

      alarm.arm(100);
      alarm.arm(110);
      alarm.cancel();

      expect(env.ports[0].postMessage).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);

      env.loadFrame();
      alarm.arm(120);
      env.service.close();
      env.service.open();
      alarm.arm(130);

      expect(env.sent()).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(2);
      warn.mockRestore();
    });

    it('keeps its id and its handlers across close and open', () => {
      const env = setup();
      env.service.open();
      env.loadFrame();
      const onWake = vi.fn();
      const alarm = env.service.wakeAlarm(onWake, noop);

      env.service.close();
      env.service.open();
      env.loadFrame();
      alarm.arm(50);
      env.fromSender({ k: 'wake', id: 1, at: TIME_ORIGIN + 50, t: TIME_ORIGIN + 50 });

      expect(env.sent()).toEqual([{ k: 'wake-at', id: 1, at: TIME_ORIGIN + 50 }]);
      expect(onWake).toHaveBeenCalledTimes(1);
    });

    it('calls every alarm with this page now on each beat of the ticker, after raising the tick', () => {
      const env = setup();
      const order: string[] = [];
      env.service.wakeAlarm(noop, (nowMs) => order.push(`first:${typeof nowMs}`));
      env.service.wakeAlarm(noop, (nowMs) => order.push(`second:${typeof nowMs}`));
      env.events.push = (...items: AsidSenderEvent[]) => {
        order.push(...items.map((item) => item.kind));
        return order.length;
      };

      env.tick();

      expect(order).toEqual(['tick', 'first:number', 'second:number']);
    });
  });

  describe('the zone', () => {
    it('installs the port handler inside runOutsideAngular', () => {
      const env = setup();
      const seen: { before: unknown; after: unknown }[] = [];
      vi.spyOn(env.zone, 'runOutsideAngular').mockImplementation((fn) => {
        const port = env.ports[env.ports.length - 1];
        const before = port.onmessage;
        const result = fn();
        seen.push({ before, after: port.onmessage });
        return result;
      });

      env.service.open();

      expect(seen).toHaveLength(1);
      expect(seen[0].before).toBeNull();
      expect(seen[0].after).not.toBeNull();
    });

    it('dispatches a wake right there and runs every other message inside the zone', () => {
      const env = setup();
      env.service.open();
      env.loadFrame();
      const run = vi.spyOn(env.zone, 'run');
      const onWake = vi.fn();
      env.service.wakeAlarm(onWake, () => undefined);

      env.fromSender({ k: 'wake', id: 1, at: TIME_ORIGIN + 5, t: TIME_ORIGIN + 5 });

      expect(onWake).toHaveBeenCalledTimes(1);
      expect(run).not.toHaveBeenCalled();

      env.fromSender({ k: 'pong', seq: 1 });

      expect(run).toHaveBeenCalled();
      expect(env.events).toContainEqual({ kind: 'pong' });
    });
  });
});
