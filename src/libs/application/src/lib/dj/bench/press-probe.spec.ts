import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASID_MSG_STOP } from '@sidablist/asid';
import { PressProbe } from './press-probe';

const REGISTERS = new Uint8Array([0xf0, 0x2d, 0x4e, 0, 0xf7]);
const STOP = new Uint8Array([0xf0, 0x2d, ASID_MSG_STOP, 0xf7]);
const OTHER = new Uint8Array([0xf0, 0x2d, 0x4c, 0xf7]);

describe('PressProbe', () => {
  let probe: PressProbe;

  beforeEach(() => {
    probe = new PressProbe();
    vi.spyOn(performance, 'now').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ends a play at a register-data send and not at another message', () => {
    probe.mark('play', 100);

    probe.sent(OTHER, 110, 105);
    expect(probe.read().all).toBeNull();

    probe.sent(REGISTERS, 110, 105);
    expect(probe.read().byKind.play).toMatchObject({ count: 1, max: 10 });
  });

  it('ends a stop at any send', () => {
    probe.mark('stop', 100);

    probe.sent(OTHER, undefined, 103);

    expect(probe.read().byKind.stop).toMatchObject({ count: 1, max: 3 });
  });

  it('ends a stop at the stop message too', () => {
    probe.mark('stop', 100);
    probe.sent(STOP, undefined, 101);
    expect(probe.read().byKind.stop?.count).toBe(1);
  });

  it('takes the later of the stamp and the send time, and the send time for an unstamped send', () => {
    probe.mark('jump', 0);
    probe.sent(REGISTERS, 20, 5);
    probe.mark('jump', 100);
    probe.sent(REGISTERS, 90, 112);
    probe.mark('jump', 200);
    probe.sent(REGISTERS, undefined, 204);

    const jump = probe.read().byKind.jump;

    expect(jump).toMatchObject({ count: 3, max: 20 });
    expect(jump?.p50).toBeCloseTo(12, 0);
  });

  it('reads the mean per kind and pooled', () => {
    probe.mark('play', 0);
    probe.sent(REGISTERS, 10, 0);
    probe.mark('play', 100);
    probe.sent(REGISTERS, 120, 100);
    probe.mark('mute', 200);
    probe.sent(REGISTERS, 230, 200);

    const reading = probe.read();

    expect(reading.byKind.play?.mean).toBe(15);
    expect(reading.byKind.mute?.mean).toBe(30);
    expect(reading.all).toMatchObject({ count: 3, mean: 20, max: 30 });
    expect(reading.byKind.stop).toBeUndefined();
  });

  it('does not end a knob with a register frame before the apply, and does with the first after', () => {
    probe.mark('knob', 0);

    probe.sent(REGISTERS, 5, 2);
    expect(probe.read().all).toBeNull();

    probe.applied();
    probe.sent(REGISTERS, 12, 6);
    probe.sent(REGISTERS, 22, 16);

    expect(probe.read().byKind.knob).toMatchObject({ count: 1, max: 12 });
  });

  describe('a knob turned in several ticks', () => {
    it('reads once per carrying frame, from the oldest tick, without counting the later ones as superseded', () => {
      probe.mark('knob', 0);
      probe.applied();
      probe.mark('knob', 4);
      probe.applied();
      probe.mark('knob', 8);

      probe.sent(REGISTERS, 20, 15);

      const reading = probe.read();
      expect(reading.byKind.knob).toMatchObject({ count: 1, max: 20 });
      expect(reading.superseded).toBe(0);
    });

    it('starts the next reading at the first tick after the frame', () => {
      probe.mark('knob', 0);
      probe.applied();
      probe.sent(REGISTERS, 10, 5);

      probe.mark('knob', 30);
      probe.mark('knob', 34);
      probe.applied();
      probe.sent(REGISTERS, 45, 40);

      expect(probe.read().byKind.knob).toMatchObject({ count: 2, max: 15 });
    });

    it('stays unapplied until the engine takes a tick, whatever ticks follow', () => {
      probe.mark('knob', 0);
      probe.mark('knob', 3);
      probe.sent(REGISTERS, 8, 6);
      expect(probe.read().all).toBeNull();

      probe.applied();
      probe.sent(REGISTERS, 18, 16);

      expect(probe.read().byKind.knob).toMatchObject({ count: 1, max: 18 });
    });

    it('keeps the oldest tick’s origin', () => {
      probe.mark('knob', 10, 2, true);
      probe.mark('knob', 12);
      probe.applied();
      probe.sent(REGISTERS, 20, 15);

      expect(probe.read()).toMatchObject({ fromController: 1, byKind: { knob: { max: 18 } } });
    });

    it('still supersedes another kind of press, and is superseded by one', () => {
      probe.mark('play', 0);
      probe.mark('knob', 5);
      probe.mark('knob', 6);
      probe.mark('mute', 10);
      probe.sent(REGISTERS, 20, 15);

      const reading = probe.read();
      expect(reading.superseded).toBe(2);
      expect(reading.byKind.knob).toBeUndefined();
      expect(reading.byKind.mute?.max).toBe(10);
    });
  });

  it('counts a mark no carrying send reaches within a second as noFrame', () => {
    probe.mark('play', 0);
    probe.sent(OTHER, 5, 500);
    expect(probe.read().noFrame).toBe(0);

    probe.sent(REGISTERS, 1_005, 1_001);

    expect(probe.read()).toMatchObject({ noFrame: 1, all: null });
  });

  it('counts a stale mark at the next mark, and at a read', () => {
    probe.mark('play', 0);
    probe.mark('stop', 2_000);
    expect(probe.read().noFrame).toBe(1);

    vi.mocked(performance.now).mockReturnValue(4_000);
    expect(probe.read().noFrame).toBe(2);
  });

  it('counts a mark replaced before a carrying send as superseded', () => {
    probe.mark('play', 0);
    probe.mark('mute', 10);
    probe.sent(REGISTERS, 20, 15);

    const reading = probe.read();

    expect(reading.superseded).toBe(1);
    expect(reading.byKind.play).toBeUndefined();
    expect(reading.byKind.mute?.max).toBe(10);
  });

  it('starts over on reset', () => {
    probe.mark('play', 0);
    probe.mark('mute', 1);
    probe.sent(REGISTERS, 5, 2);

    probe.reset();

    expect(probe.read()).toEqual({
      byKind: {},
      all: null,
      fromController: 0,
      noFrame: 0,
      superseded: 0,
    });
    probe.sent(REGISTERS, 9, 9);
    expect(probe.read().all).toBeNull();
  });
  describe('a press from a controller', () => {
    it('is timed from the message arrival, not the mark, and counted as from a controller', () => {
      probe.mark('play', 100, 70, true);
      probe.sent(REGISTERS, 110, 105);

      const reading = probe.read();

      expect(reading.byKind.play).toMatchObject({ count: 1, max: 40 });
      expect(reading.fromController).toBe(1);
    });

    it('counts only the readings that started at a controller', () => {
      probe.mark('play', 0, 0, false);
      probe.sent(REGISTERS, 10, 0);
      probe.mark('mute', 100, 90, true);
      probe.sent(REGISTERS, 110, 100);

      expect(probe.read()).toMatchObject({ fromController: 1, all: { count: 2 } });
    });

    it('expires a second after the arrival', () => {
      probe.mark('play', 1_000, 0, true);
      probe.sent(REGISTERS, 1_005, 1_001);

      expect(probe.read()).toMatchObject({ noFrame: 1, all: null });
    });
  });

  describe('the hand', () => {
    it('reads a touch and a lift as presses', () => {
      probe.mark('hand-touch', 0);
      probe.sent(REGISTERS, 7, 2);
      probe.mark('hand-lift', 100);
      probe.sent(REGISTERS, 109, 104);

      const reading = probe.read();

      expect(reading.byKind['hand-touch']).toMatchObject({ count: 1, max: 7 });
      expect(reading.byKind['hand-lift']).toMatchObject({ count: 1, max: 9 });
    });

    it('records one move per frame, the oldest the frame carries', () => {
      probe.mark('hand-move', 0);
      probe.mark('hand-move', 2);
      probe.mark('hand-move', 4);
      probe.sent(REGISTERS, 15, 5);
      probe.mark('hand-move', 20);
      probe.mark('hand-move', 23);
      probe.sent(REGISTERS, 30, 25);

      const moves = probe.read().byKind['hand-move'];

      expect(moves).toMatchObject({ count: 2, max: 15 });
      expect(probe.read().superseded).toBe(0);
    });

    it('ends a move only at a register frame', () => {
      probe.mark('hand-move', 0);
      probe.sent(STOP, undefined, 3);
      expect(probe.read().byKind['hand-move']).toBeUndefined();

      probe.sent(REGISTERS, 8, 4);
      expect(probe.read().byKind['hand-move']).toMatchObject({ count: 1, max: 8 });
    });

    it('neither supersedes a pending press nor is superseded by one, and one frame ends both', () => {
      probe.mark('hand-touch', 0);
      probe.mark('hand-move', 1);
      probe.mark('hand-move', 2);
      probe.sent(REGISTERS, 10, 3);

      const reading = probe.read();

      expect(reading.superseded).toBe(0);
      expect(reading.byKind['hand-touch']).toMatchObject({ count: 1, max: 10 });
      expect(reading.byKind['hand-move']).toMatchObject({ count: 1, max: 9 });
      expect(reading.all?.count).toBe(2);
    });

    it('counts a move no frame carries within a second as noFrame', () => {
      probe.mark('hand-move', 0);

      vi.mocked(performance.now).mockReturnValue(1_500);

      expect(probe.read()).toMatchObject({ noFrame: 1, all: null });
    });

    it('drops a pending move on reset', () => {
      probe.mark('hand-move', 0);
      probe.reset();
      probe.sent(REGISTERS, 5, 2);

      expect(probe.read().all).toBeNull();
    });
  });
});
