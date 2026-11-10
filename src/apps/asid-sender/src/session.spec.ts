import {
  ASID_SENDER_IDENTITY,
  ASID_SENDER_PROTOCOL_VERSION,
  isSenderToApp,
  type SenderTimingReport,
  type SenderToApp,
} from '@teensyrom-nx/asid-sender-protocol';
import type { MidiOutputLike } from './midi-outputs';
import { Session } from './session';

const TIME_ORIGIN = 1_700_000_000_000;
const sysex = (id: number) => new Uint8Array([0xf0, id, 0xf7]);

interface FakeOutput extends MidiOutputLike {
  sent: { id: number; atMs: number }[];
  failWith?: Error;
}

function rig(options: { midiFails?: boolean } = {}) {
  const clock = { t: 5000 };
  const toApp: SenderToApp[] = [];
  const armed: { id: number; delayMs: number }[] = [];
  const probes: { seq: number; delayMs: number }[] = [];
  const counts = { turns: 0, ticks: 0 };
  const hooks: { permission: (state: string) => void } = { permission: () => undefined };

  const fakeOutput = (name: string): FakeOutput => {
    const out: FakeOutput = {
      name,
      sent: [],
      send: (data) => {
        if (out.failWith) {
          throw out.failWith;
        }
        out.sent.push({ id: data[1], atMs: clock.t });
      },
    };
    return out;
  };
  const outputs = { a: fakeOutput('TeensyROM-aaaa'), b: fakeOutput('TeensyROM-bbbb') };

  const session = new Session({
    port: { postMessage: (message) => toApp.push(message) },
    now: () => clock.t,
    timeOrigin: TIME_ORIGIN,
    random: () => 0.5,
    alarm: {
      arm: (id, delayMs) => armed.push({ id, delayMs }),
      disarm: () => undefined,
      probe: (seq, delayMs) => probes.push({ seq, delayMs }),
    },
    postTurn: () => counts.turns++,
    postTick: () => counts.ticks++,
    requestMidiAccess: async () => {
      if (options.midiFails) {
        throw new DOMException('denied', 'SecurityError');
      }
      return { outputs: () => Object.values(outputs), onChange: () => undefined };
    },
    watchMidiPermission: (listener) => {
      hooks.permission = listener;
    },
    visibility: () => 'visible',
  });

  const timingReport = (): SenderTimingReport => {
    session.onMessage({ k: 'timing', id: 99 });
    const message = toApp[toApp.length - 1];
    if (message.k !== 'timing') {
      throw new Error('no timing report was posted');
    }
    return message.report;
  };
  const packet = (token: string, id: number, dueLocalMs: number | null) => ({
    k: 'packet',
    token,
    bytes: sysex(id),
    due: dueLocalMs === null ? null : TIME_ORIGIN + dueLocalMs,
  });
  /** The worker's alarm going off, `lateByMs` after it was asked for. */
  const fireAlarm = (lateByMs = 0) => {
    const alarm = armed[armed.length - 1];
    clock.t += alarm.delayMs + lateByMs;
    session.onAlarm(alarm.id);
  };
  return {
    clock,
    toApp,
    armed,
    probes,
    counts,
    hooks,
    outputs,
    session,
    timingReport,
    packet,
    fireAlarm,
  };
}

describe('Session', () => {
  describe('connecting', () => {
    it('says hello at once, and on MIDI success posts the outputs before ready', async () => {
      const r = rig();
      const started = r.session.start();
      expect(r.toApp).toEqual([
        { k: 'hello', identity: ASID_SENDER_IDENTITY, version: ASID_SENDER_PROTOCOL_VERSION },
      ]);

      await started;
      expect(r.toApp.map((m) => m.k)).toEqual(['hello', 'outputs', 'ready']);
      expect(r.toApp[1]).toEqual({ k: 'outputs', tokens: ['aaaa', 'bbbb'] });
      expect(r.toApp[2]).toEqual({ k: 'ready', midi: true });
      expect(r.toApp.every((m) => isSenderToApp(m))).toBe(true);
    });

    it('says ready with midi false and the error when MIDI is refused', async () => {
      const r = rig({ midiFails: true });
      await r.session.start();
      expect(r.toApp.map((m) => m.k)).toEqual(['hello', 'ready']);
      expect(r.toApp[1]).toEqual({ k: 'ready', midi: false, error: 'SecurityError: denied' });
    });

    it('answers with its own protocol version whatever the app asked for', async () => {
      const r = rig();
      await r.session.start();
      expect(r.toApp[0]).toMatchObject({ k: 'hello', version: ASID_SENDER_PROTOCOL_VERSION });
    });

    it('says hello with protocol version 2', async () => {
      const r = rig();
      await r.session.start();
      expect(r.toApp[0]).toMatchObject({ k: 'hello', version: 2 });
    });
  });

  describe('heartbeat', () => {
    it('answers each ping with a pong of the same seq, at once', async () => {
      const r = rig();
      await r.session.start();
      r.toApp.length = 0;
      r.session.onMessage({ k: 'ping', seq: 7 });
      r.session.onMessage({ k: 'ping', seq: 8 });
      expect(r.toApp).toEqual([
        { k: 'pong', seq: 7 },
        { k: 'pong', seq: 8 },
      ]);
    });

    it('stops answering pings once its alarm worker has failed, so the app sees it has stopped', async () => {
      const r = rig();
      await r.session.start();
      r.session.onMessage({ k: 'ping', seq: 1 });
      r.toApp.length = 0;

      r.session.onAlarmFailed();
      r.session.onMessage({ k: 'ping', seq: 2 });
      r.session.onMessage({ k: 'ping', seq: 3 });

      expect(r.toApp).toEqual([]);
    });

    it("records the app's quiet time and never acts on it", async () => {
      const r = rig();
      await r.session.start();
      r.session.onMessage({ k: 'ping', seq: 1 });
      r.clock.t += 60_000; // the app goes quiet for a minute
      r.session.onMessage({ k: 'ping', seq: 2 });
      r.clock.t += 30_000;

      // Still sending afterwards.
      r.session.onMessage(r.packet('aaaa', 1, null));
      expect(r.outputs.a.sent).toHaveLength(1);
      expect(r.timingReport().appQuietMaxMs).toBe(60_000);
    });
  });

  describe('packets', () => {
    it('holds a frame until its due time on the shared clock and sends it then', async () => {
      const r = rig();
      await r.session.start();
      const due = r.clock.t + 50;
      r.session.onMessage(r.packet('aaaa', 1, due));
      expect(r.outputs.a.sent).toHaveLength(0);
      expect(r.armed[0].delayMs).toBeCloseTo(47, 6);

      r.fireAlarm(0.3); // wakes 2.7 ms before the frame
      expect(r.counts.turns).toBe(1);
      r.clock.t = due;
      r.session.onTurn();
      expect(r.outputs.a.sent).toEqual([{ id: 1, atMs: due }]);

      const [cartridge] = r.timingReport().cartridges;
      expect(cartridge).toMatchObject({ token: 'aaaa', packets: 1 });
      expect(cartridge.send.max).toBe(0);
      expect(cartridge.arrival.spareMinMs).toBeCloseTo(50, 6);
    });

    it('sends a packet with no due time at once', async () => {
      const r = rig();
      await r.session.start();
      r.session.onMessage(r.packet('bbbb', 4, null));
      expect(r.outputs.b.sent).toEqual([{ id: 4, atMs: 5000 }]);
    });

    it('sends a frame that arrived past due at once and says so in the record', async () => {
      const r = rig();
      await r.session.start();
      r.session.onMessage(r.packet('aaaa', 1, r.clock.t - 8));
      expect(r.outputs.a.sent).toHaveLength(1);
      expect(r.timingReport().cartridges[0].arrival).toMatchObject({ pastDue: 1, pastDueMaxMs: 8 });
    });

    it('drops and counts a packet for a cartridge it does not list', async () => {
      const r = rig();
      await r.session.start();
      r.session.onMessage(r.packet('cccc', 1, null));
      expect(r.outputs.a.sent).toHaveLength(0);
      expect(r.outputs.b.sent).toHaveLength(0);
      expect(r.timingReport().cartridges).toEqual([
        expect.objectContaining({ token: 'cccc', packets: 0, dropped: 1 }),
      ]);
    });

    it('drops and counts an invalid packet against its cartridge', async () => {
      const r = rig();
      await r.session.start();
      r.session.onMessage({
        k: 'packet',
        token: 'aaaa',
        bytes: new Uint8Array([0x90, 1, 2]),
        due: null,
      });
      r.session.onMessage({ k: 'packet', token: 'aaaa', bytes: sysex(1), due: NaN });
      r.session.onMessage({ k: 'packet', token: 'aaaa', bytes: new Uint8Array(2000), due: null });
      expect(r.outputs.a.sent).toHaveLength(0);
      expect(r.timingReport().cartridges[0]).toMatchObject({ token: 'aaaa', dropped: 3 });
    });

    it('ignores messages it cannot read without answering', async () => {
      const r = rig();
      await r.session.start();
      r.toApp.length = 0;
      for (const junk of [
        undefined,
        null,
        5,
        'ping',
        [],
        {},
        { k: 'nope' },
        { k: 'packet' },
        { k: 'packet', token: 7 },
      ]) {
        r.session.onMessage(junk);
      }
      expect(r.toApp).toEqual([]);
      expect(r.timingReport().cartridges).toEqual([]);
    });

    it('lets one cartridge fail without stopping the other, and tells the app once', async () => {
      const r = rig();
      await r.session.start();
      r.outputs.a.failWith = new Error('port closed');
      r.toApp.length = 0;

      r.session.onMessage(r.packet('aaaa', 1, null));
      r.session.onMessage(r.packet('aaaa', 2, null));
      r.session.onMessage(r.packet('bbbb', 3, null));
      expect(r.outputs.b.sent).toHaveLength(1);
      expect(r.toApp.filter((m) => m.k === 'fault')).toEqual([
        { k: 'fault', fault: 'send-failed', token: 'aaaa', detail: 'Error: port closed' },
      ]);
      const byToken = Object.fromEntries(r.timingReport().cartridges.map((c) => [c.token, c]));
      expect(byToken['aaaa']).toMatchObject({ failedSends: 2, packets: 0 });
      expect(byToken['bbbb']).toMatchObject({ failedSends: 0, packets: 1 });
    });

    it('tells the app when MIDI permission is lost', async () => {
      const r = rig();
      await r.session.start();
      r.toApp.length = 0;
      r.hooks.permission('prompt');
      expect(r.toApp).toEqual([
        { k: 'fault', fault: 'midi-lost', detail: 'MIDI permission is prompt' },
      ]);
    });
  });

  describe('wakes', () => {
    it('posts a wake once its time comes, never before, with both times on the shared clock', async () => {
      const r = rig();
      await r.session.start();
      r.toApp.length = 0;
      const at = r.clock.t + 50;
      r.session.onMessage({ k: 'wake-at', id: 3, at: TIME_ORIGIN + at });
      expect(r.toApp).toEqual([]);
      expect(r.armed[0].delayMs).toBeCloseTo(47, 6);

      r.fireAlarm(0.3);
      r.clock.t = at - 0.1;
      r.session.onTurn();
      expect(r.toApp).toEqual([]);

      r.clock.t = at + 0.2;
      r.session.onTurn();
      expect(r.toApp).toEqual([
        { k: 'wake', id: 3, at: TIME_ORIGIN + at, t: TIME_ORIGIN + at + 0.2 },
      ]);
      expect(isSenderToApp(r.toApp[0])).toBe(true);
    });

    it('posts a wake for a time already past at once', async () => {
      const r = rig();
      await r.session.start();
      r.toApp.length = 0;
      r.session.onMessage({ k: 'wake-at', id: 1, at: TIME_ORIGIN + r.clock.t - 5 });
      expect(r.toApp).toEqual([
        { k: 'wake', id: 1, at: TIME_ORIGIN + r.clock.t - 5, t: TIME_ORIGIN + r.clock.t },
      ]);
    });

    it('sends nothing for a cancelled wake', async () => {
      const r = rig();
      await r.session.start();
      r.toApp.length = 0;
      r.session.onMessage({ k: 'wake-at', id: 1, at: TIME_ORIGIN + r.clock.t + 50 });
      r.session.onMessage({ k: 'wake-cancel', id: 1 });
      r.fireAlarm();
      r.clock.t += 10;
      r.session.onTurn();
      expect(r.toApp).toEqual([]);
    });

    it('drops malformed wake-at and wake-cancel without arming or answering', async () => {
      const r = rig();
      await r.session.start();
      r.toApp.length = 0;
      r.session.onMessage({ k: 'wake-at', id: 0, at: TIME_ORIGIN + r.clock.t });
      r.session.onMessage({ k: 'wake-at', id: 1.5, at: TIME_ORIGIN + r.clock.t });
      r.session.onMessage({ k: 'wake-at', id: 1, at: NaN });
      r.session.onMessage({ k: 'wake-at', id: 1 });
      r.session.onMessage({ k: 'wake-cancel', id: -2 });
      r.session.onMessage({ k: 'wake-cancel' });
      expect(r.toApp).toEqual([]);
      expect(r.armed).toHaveLength(0);
    });
  });

  describe('the own-thread test', () => {
    it('arms a ticker and answers, then counts the turns inside the hold', async () => {
      const r = rig();
      await r.session.start();
      r.toApp.length = 0;
      r.session.onMessage({ k: 'test-arm', id: 3 });
      expect(r.toApp).toEqual([{ k: 'test-armed', id: 3 }]);
      expect(r.counts.ticks).toBe(1);

      for (let i = 0; i < 50; i++) {
        r.clock.t += 2;
        r.session.onTick();
      }
      const holdStart = TIME_ORIGIN + 5020;
      const holdEnd = TIME_ORIGIN + 5060;
      r.session.onMessage({ k: 'test-end', id: 3, holdStart, holdEnd });
      expect(r.toApp[1]).toEqual({ k: 'test-result', id: 3, turns: 21 });
    });

    it('counts zero for a hold it could not run through', async () => {
      const r = rig();
      await r.session.start();
      r.session.onMessage({ k: 'test-arm', id: 1 });
      r.clock.t += 1;
      r.session.onTick();
      r.clock.t += 300; // shared thread held
      r.session.onTick();
      r.session.onMessage({
        k: 'test-end',
        id: 1,
        holdStart: TIME_ORIGIN + 5010,
        holdEnd: TIME_ORIGIN + 5290,
      });
      expect(r.toApp[r.toApp.length - 1]).toEqual({ k: 'test-result', id: 1, turns: 0 });
    });
  });

  describe('the timing record', () => {
    it('answers a timing request with a report the protocol accepts', async () => {
      const r = rig();
      await r.session.start();
      r.session.onMessage(r.packet('aaaa', 1, null));
      r.session.onMessage({ k: 'timing', id: 5 });
      const message = r.toApp[r.toApp.length - 1];
      expect(message).toMatchObject({ k: 'timing', id: 5 });
      expect(isSenderToApp(structuredClone(message))).toBe(true);
    });

    it('clears on request and starts its clock again at 0', async () => {
      const r = rig();
      await r.session.start();
      r.session.onMessage(r.packet('aaaa', 1, null));
      r.clock.t += 20_000;
      expect(r.timingReport().sinceS).toBe(20);

      r.session.onMessage({ k: 'timing-clear' });
      r.clock.t += 2_000;
      const report = r.timingReport();
      expect(report.sinceS).toBe(2);
      expect(report.cartridges).toEqual([]);
      expect(report.timeline).toEqual([]);
    });

    it('logs visibility changes', async () => {
      const r = rig();
      await r.session.start();
      r.clock.t += 3_000;
      r.session.onVisibility('hidden');
      expect(r.timingReport().visibility).toEqual([
        { atS: 0, state: 'visible' },
        { atS: 3, state: 'hidden' },
      ]);
    });

    it('records the margin and wake-ups the alarm brought', async () => {
      const r = rig();
      await r.session.start();
      r.session.onMessage(r.packet('aaaa', 1, r.clock.t + 100));
      r.fireAlarm(1.5);
      const report = r.timingReport();
      expect(report.wake).toMatchObject({ count: 1, max: 1.5 });
      expect(report.marginMs.now).toBe(3);
    });
  });
});
