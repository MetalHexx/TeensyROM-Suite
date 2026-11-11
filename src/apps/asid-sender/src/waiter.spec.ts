import { MAX_WAKE_ALARMS } from '@teensyrom-nx/asid-sender-protocol';
import { ReleaseQueue, type HeldPacket } from './release-queue';
import { PROBE_KEEP_ALIVE_MS, PROBE_MAX_MS, PROBE_MIN_MS, Waiter } from './waiter';
import { MARGIN_FLOOR_MS, WakeMargin } from './wake-margin';

const BYTES = new Uint8Array([0xf0, 1, 0xf7]);

interface Armed {
  id: number;
  delayMs: number;
}

function rig(random = () => 0.5) {
  const clock = { t: 1000 };
  const armed: Armed[] = [];
  const probes: { seq: number; delayMs: number }[] = [];
  const released: { held: HeldPacket; nowMs: number }[] = [];
  const woken: { id: number; askedAtMs: number; nowMs: number }[] = [];
  /** Every send in the order it left, packets as their token and wakes as `wake:<id>`. */
  const order: string[] = [];
  const wakes: { latenessMs: number; probe: boolean }[] = [];
  const counts = { disarms: 0, turns: 0 };
  const sendCostMs = { value: 0 };

  const queue = new ReleaseQueue();
  const margin = new WakeMargin();
  const waiter = new Waiter(queue, margin, {
    now: () => clock.t,
    random,
    alarm: {
      arm: (id, delayMs) => armed.push({ id, delayMs }),
      disarm: () => counts.disarms++,
      probe: (seq, delayMs) => probes.push({ seq, delayMs }),
    },
    postTurn: () => counts.turns++,
    release: (held, nowMs) => {
      released.push({ held, nowMs });
      order.push(held.token);
      clock.t += sendCostMs.value;
    },
    wake: (id, askedAtMs, nowMs) => {
      woken.push({ id, askedAtMs, nowMs });
      order.push(`wake:${id}`);
      clock.t += sendCostMs.value;
    },
    recordWake: (latenessMs, _nowMs, probe) => wakes.push({ latenessMs, probe }),
  });

  /** The alarm worker answering the latest alarm, `lateByMs` after it was asked for. */
  const fireAlarm = (lateByMs = 0) => {
    const alarm = armed[armed.length - 1];
    clock.t += alarm.delayMs + lateByMs;
    waiter.onAlarm(alarm.id);
  };
  /** The worker answering the latest probe, `lateByMs` after it was asked for. Returns false if none is out. */
  const fireProbe = (lateByMs = 0) => {
    const probe = probes.pop();
    if (!probe) {
      return false;
    }
    clock.t += probe.delayMs + lateByMs;
    waiter.onProbe(probe.seq);
    return true;
  };
  return {
    clock,
    armed,
    probes,
    released,
    woken,
    order,
    wakes,
    counts,
    sendCostMs,
    queue,
    margin,
    waiter,
    fireAlarm,
    fireProbe,
  };
}

describe('Waiter', () => {
  describe('holding and sending', () => {
    it('sends a packet with no due time at once', () => {
      const r = rig();
      r.waiter.submit('a', BYTES, null);
      expect(r.released).toHaveLength(1);
      expect(r.released[0].nowMs).toBe(1000);
      expect(r.armed).toHaveLength(0);
      expect(r.counts.turns).toBe(0);
    });

    it('sends a packet that arrived past due at once', () => {
      const r = rig();
      r.waiter.submit('a', BYTES, 990);
      expect(r.released).toHaveLength(1);
      expect(r.released[0].held.leadMs).toBe(-10);
    });

    it('sleeps rather than spins when the head is far off', () => {
      const r = rig();
      r.waiter.submit('a', BYTES, 1100);
      expect(r.released).toHaveLength(0);
      expect(r.counts.turns).toBe(0);
      expect(r.armed).toEqual([{ id: 1, delayMs: 100 - MARGIN_FLOOR_MS }]);
    });

    it('sleeps between frames, then spins only for the margin before the next one', () => {
      const r = rig();
      r.waiter.submit('a', BYTES, 1020);
      r.waiter.submit('a', BYTES, 1040);

      r.fireAlarm(0.4); // wakes 3 ms before the first frame, 0.4 ms late
      expect(r.released).toHaveLength(0);
      expect(r.counts.turns).toBe(1);

      r.clock.t = 1020;
      r.waiter.onTurn();
      expect(r.released).toHaveLength(1);
      // The next frame is 20 ms away: sleep again, with no spin posted.
      expect(r.counts.turns).toBe(1);
      expect(r.armed[r.armed.length - 1].delayMs).toBeCloseTo(17, 6);

      r.fireAlarm();
      r.clock.t = 1040;
      r.waiter.onTurn();
      expect(r.released).toHaveLength(2);
      // Nothing left: idle, nothing armed.
      const armedAfter = r.armed.length;
      expect(r.counts.turns).toBe(2);
      r.waiter.onTurn();
      expect(r.armed).toHaveLength(armedAfter);
    });

    it('sends everything due in one turn and re-reads the clock after each send', () => {
      const r = rig();
      r.sendCostMs.value = 2;
      r.waiter.submit('a', BYTES, 1010);
      r.waiter.submit('b', BYTES, 1011);
      r.waiter.submit('c', BYTES, 1012);
      r.fireAlarm(); // 3 ms before the first: spin
      r.clock.t = 1010;
      r.waiter.onTurn();
      expect(r.released.map((x) => x.held.token)).toEqual(['a', 'b', 'c']);
      expect(r.released.map((x) => x.nowMs)).toEqual([1010, 1012, 1014]);
    });

    it('ignores a turn delivered while it is not spinning', () => {
      const r = rig();
      r.waiter.submit('a', BYTES, 1100);
      r.clock.t = 1100;
      r.waiter.onTurn();
      expect(r.released).toHaveLength(0);
    });
  });

  describe('waking', () => {
    it('re-arms for a packet due before the armed time, and ignores the stale alarm', () => {
      const r = rig();
      r.waiter.submit('a', BYTES, 1100);
      r.waiter.submit('b', BYTES, 1050);
      expect(r.counts.disarms).toBe(1);
      expect(r.armed).toEqual([
        { id: 1, delayMs: 97 },
        { id: 2, delayMs: 47 },
      ]);

      r.clock.t = 1100;
      r.waiter.onAlarm(1);
      expect(r.released).toHaveLength(0);
      expect(r.wakes).toHaveLength(0);
    });

    it('leaves the alarm alone for a packet due after the armed time', () => {
      const r = rig();
      r.waiter.submit('a', BYTES, 1050);
      r.waiter.submit('a', BYTES, 1100);
      r.waiter.submit('b', BYTES, 1050);
      expect(r.counts.disarms).toBe(0);
      expect(r.armed).toHaveLength(1);
    });

    it('sends a packet that falls due while spinning without touching the alarm', () => {
      const r = rig();
      r.waiter.submit('a', BYTES, 1002);
      expect(r.counts.turns).toBe(1);
      r.waiter.submit('a', BYTES, 1004);
      expect(r.counts.turns).toBe(1);
      expect(r.armed).toHaveLength(0);
    });

    it('feeds the wake-up lateness to the margin and the record', () => {
      const r = rig();
      r.waiter.submit('a', BYTES, 1100);
      r.fireAlarm(2.5);
      expect(r.wakes).toEqual([{ latenessMs: 2.5, probe: false }]);
    });

    it('widens the margin when wake-ups run late, so it sleeps for less', () => {
      const r = rig();
      for (let i = 0; i < 40; i++) {
        r.waiter.submit('a', BYTES, r.clock.t + 30);
        r.fireAlarm(9);
        r.clock.t += 5; // the packet is released on the spin turn
        r.waiter.onTurn();
      }
      expect(r.margin.marginMs).toBeGreaterThan(MARGIN_FLOOR_MS);
    });
  });

  describe('wake alarms', () => {
    it('sends a wake for a time already past on the next turn, at once from idle', () => {
      const r = rig();
      expect(r.waiter.arm(1, 990)).toBe(true);
      expect(r.woken).toEqual([{ id: 1, askedAtMs: 990, nowMs: 1000 }]);
      expect(r.armed).toHaveLength(0);
    });

    it('sleeps for a future wake, spins into it and sends it no earlier than its time', () => {
      const r = rig();
      r.waiter.arm(1, 1100);
      expect(r.woken).toHaveLength(0);
      expect(r.armed).toEqual([{ id: 1, delayMs: 100 - MARGIN_FLOOR_MS }]);

      r.fireAlarm(0.4);
      expect(r.woken).toHaveLength(0);
      expect(r.counts.turns).toBe(1);

      r.clock.t = 1099.9;
      r.waiter.onTurn();
      expect(r.woken).toHaveLength(0);
      expect(r.counts.turns).toBe(2);

      r.clock.t = 1100;
      r.waiter.onTurn();
      expect(r.woken).toEqual([{ id: 1, askedAtMs: 1100, nowMs: 1100 }]);
      expect(r.counts.turns).toBe(2);
    });

    it('sends a due wake and a due packet in one turn, in time order', () => {
      const r = rig();
      r.waiter.arm(1, 1010);
      r.waiter.submit('a', BYTES, 1012);
      r.waiter.submit('b', BYTES, 1008);
      r.fireAlarm();
      r.clock.t = 1020;
      r.waiter.onTurn();
      expect(r.order).toEqual(['b', 'wake:1', 'a']);
    });

    it('sends the packet first when a wake and a packet fall due together', () => {
      const r = rig();
      r.waiter.arm(1, 1010);
      r.waiter.submit('a', BYTES, 1010);
      r.fireAlarm();
      r.clock.t = 1010;
      r.waiter.onTurn();
      expect(r.order).toEqual(['a', 'wake:1']);
    });

    it('re-reads the clock after each send, so a wake that falls due during a send waits its turn', () => {
      const r = rig();
      r.sendCostMs.value = 5;
      r.waiter.submit('a', BYTES, 1010);
      r.waiter.arm(1, 1013);
      r.fireAlarm();
      r.clock.t = 1010;
      r.waiter.onTurn();
      expect(r.order).toEqual(['a', 'wake:1']);
      expect(r.woken[0].nowMs).toBe(1015);
    });

    it('replaces the time of an id armed again', () => {
      const r = rig();
      r.waiter.arm(1, 1100);
      r.waiter.arm(1, 1300);
      r.clock.t = 1100;
      r.waiter.onAlarm(r.armed[r.armed.length - 1].id);
      expect(r.woken).toHaveLength(0);

      r.waiter.arm(1, 1050);
      expect(r.woken).toEqual([{ id: 1, askedAtMs: 1050, nowMs: 1100 }]);
    });

    it('re-sleeps for an earlier wake than the one it sleeps for, and ignores the stale alarm', () => {
      const r = rig();
      r.waiter.arm(1, 1100);
      r.waiter.arm(2, 1050);
      expect(r.counts.disarms).toBe(1);
      expect(r.armed).toEqual([
        { id: 1, delayMs: 97 },
        { id: 2, delayMs: 47 },
      ]);
      r.clock.t = 1100;
      r.waiter.onAlarm(1);
      expect(r.woken).toHaveLength(0);
    });

    it('leaves the alarm alone for a later wake, and re-sleeps for a wake before a held packet', () => {
      const r = rig();
      r.waiter.submit('a', BYTES, 1100);
      r.waiter.arm(1, 1200);
      expect(r.counts.disarms).toBe(0);
      r.waiter.arm(2, 1050);
      expect(r.counts.disarms).toBe(1);
      expect(r.armed[r.armed.length - 1].delayMs).toBe(47);
    });

    it('sends nothing for a cancelled wake, though its sleep may wake early', () => {
      const r = rig();
      r.waiter.arm(1, 1100);
      r.waiter.cancel(1);
      r.fireAlarm();
      r.waiter.onTurn();
      expect(r.woken).toHaveLength(0);
      const armedAfter = r.armed.length;
      r.waiter.onTurn();
      expect(r.armed).toHaveLength(armedAfter);
    });

    it('sleeps again for the packet that is left when the wake is cancelled', () => {
      const r = rig();
      r.waiter.arm(1, 1050);
      r.waiter.submit('a', BYTES, 1100);
      r.waiter.cancel(1);
      r.fireAlarm();
      expect(r.armed[r.armed.length - 1].delayMs).toBeCloseTo(1100 - 3 - r.clock.t, 6);
    });

    it('refuses a new id at capacity and still re-arms one that is armed', () => {
      const r = rig();
      for (let id = 1; id <= MAX_WAKE_ALARMS; id++) {
        expect(r.waiter.arm(id, 5000 + id)).toBe(true);
      }
      const armedBefore = r.armed.length;
      expect(r.waiter.arm(MAX_WAKE_ALARMS + 1, 1500)).toBe(false);
      expect(r.armed).toHaveLength(armedBefore);
      expect(r.waiter.arm(1, 6000)).toBe(true);
    });

    it('feeds the margin from a wake-up for a wake, as for a packet', () => {
      const r = rig();
      r.waiter.arm(1, 1100);
      r.fireAlarm(2.5);
      expect(r.wakes).toEqual([{ latenessMs: 2.5, probe: false }]);
    });
  });

  describe('the steady check with wakes only', () => {
    it('starts with the first wake armed and keeps the margin learning', () => {
      const r = rig();
      r.waiter.arm(1, 1000 + 5 * PROBE_KEEP_ALIVE_MS);
      expect(r.probes).toHaveLength(1);
      for (let i = 0; i < 25; i++) {
        r.waiter.arm(1, 1000 + 5 * PROBE_KEEP_ALIVE_MS);
        r.fireProbe(9);
      }
      expect(r.wakes.every((w) => w.probe && w.latenessMs === 9)).toBe(true);
      expect(r.margin.marginMs).toBe(10);
    });

    it('stops 1,000 ms after the last wake was armed', () => {
      const r = rig();
      r.waiter.arm(1, 1000 + 5 * PROBE_KEEP_ALIVE_MS);
      const armedAt = r.clock.t;
      let rounds = 0;
      while (r.fireProbe()) {
        rounds++;
        expect(rounds).toBeLessThan(200);
      }
      expect(r.clock.t - armedAt).toBeGreaterThanOrEqual(PROBE_KEEP_ALIVE_MS);
      expect(r.clock.t - armedAt).toBeLessThan(PROBE_KEEP_ALIVE_MS + PROBE_MAX_MS + 1);
    });
  });

  describe('the steady check', () => {
    it('starts with the first packet and asks for 20 to 30 ms waits', () => {
      const r = rig(() => 0);
      r.waiter.submit('a', BYTES, null);
      expect(r.probes).toEqual([{ seq: 1, delayMs: PROBE_MIN_MS }]);

      const top = rig(() => 0.999999);
      top.waiter.submit('a', BYTES, null);
      expect(top.probes).toEqual([{ seq: 1, delayMs: PROBE_MAX_MS }]);
    });

    it('never asks for a wait that reaches 32 ms, however the dice fall', () => {
      let draw = 0;
      const r = rig(() => (draw++ % 1000) / 1000);
      r.waiter.submit('a', BYTES, null);
      const delays: number[] = [r.probes[r.probes.length - 1].delayMs];
      for (let i = 0; i < 400; i++) {
        r.waiter.submit('a', BYTES, null);
        r.fireProbe();
        const next = r.probes[r.probes.length - 1];
        if (next) {
          delays.push(next.delayMs);
        }
      }
      expect(Math.max(...delays)).toBeLessThan(32);
      expect(Math.min(...delays)).toBeGreaterThanOrEqual(PROBE_MIN_MS);
    });

    it("feeds each probe's lateness to the margin", () => {
      const r = rig();
      r.waiter.submit('a', BYTES, null);
      for (let i = 0; i < 25; i++) {
        r.waiter.submit('a', BYTES, null);
        r.fireProbe(9);
      }
      expect(r.wakes.every((w) => w.probe && w.latenessMs === 9)).toBe(true);
      expect(r.margin.marginMs).toBe(10);
    });

    it('stops 1,000 ms after the last packet, and arms nothing more', () => {
      const r = rig();
      r.waiter.submit('a', BYTES, null);
      const lastPacketAt = r.clock.t;

      let rounds = 0;
      while (r.fireProbe()) {
        rounds++;
        expect(rounds).toBeLessThan(200);
      }
      expect(r.clock.t - lastPacketAt).toBeGreaterThanOrEqual(PROBE_KEEP_ALIVE_MS);
      expect(r.clock.t - lastPacketAt).toBeLessThan(PROBE_KEEP_ALIVE_MS + PROBE_MAX_MS + 1);
      expect(r.probes).toHaveLength(0);
      expect(r.armed).toHaveLength(0);
    });

    it('keeps going while packets keep arriving, and starts again on the next packet', () => {
      const r = rig();
      r.waiter.submit('a', BYTES, null);
      for (let i = 0; i < 100; i++) {
        r.clock.t += 20;
        r.waiter.submit('a', BYTES, null);
        r.fireProbe();
      }
      expect(r.probes).toHaveLength(1);

      while (r.fireProbe()) {
        // drain until it stops
      }
      expect(r.probes).toHaveLength(0);

      r.waiter.submit('a', BYTES, null);
      expect(r.probes).toHaveLength(1);
    });

    it('ignores an answer to a probe it has since replaced', () => {
      const r = rig();
      r.waiter.submit('a', BYTES, null);
      const first = r.probes[0];
      r.fireProbe();
      r.waiter.onProbe(first.seq);
      expect(r.wakes).toHaveLength(1);
      expect(r.probes).toHaveLength(1);
    });
  });
});
