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

  it('does not end a nudge with a register frame before the apply, and does with the first after', () => {
    probe.mark('nudge', 0);

    probe.sent(REGISTERS, 5, 2);
    expect(probe.read().all).toBeNull();

    probe.applied();
    probe.sent(REGISTERS, 12, 6);
    probe.sent(REGISTERS, 22, 16);

    expect(probe.read().byKind.nudge).toMatchObject({ count: 1, max: 12 });
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

    expect(probe.read()).toEqual({ byKind: {}, all: null, noFrame: 0, superseded: 0 });
    probe.sent(REGISTERS, 9, 9);
    expect(probe.read().all).toBeNull();
  });
});
