import { MAX_WAKE_ALARMS } from '@teensyrom-nx/asid-sender-protocol';
import { WakeAlarms } from './wake-alarms';

describe('WakeAlarms', () => {
  it('is empty at first', () => {
    const alarms = new WakeAlarms();
    expect(alarms.nextAtMs()).toBeNull();
    expect(alarms.takeDue(Infinity)).toBeNull();
  });

  it('hands back the earliest alarm first, and never one still in the future', () => {
    const alarms = new WakeAlarms();
    alarms.set(1, 300);
    alarms.set(2, 100);
    alarms.set(3, 200);
    expect(alarms.nextAtMs()).toBe(100);
    expect(alarms.takeDue(99.9)).toBeNull();
    expect(alarms.takeDue(250)).toEqual({ id: 2, atMs: 100 });
    expect(alarms.takeDue(250)).toEqual({ id: 3, atMs: 200 });
    expect(alarms.takeDue(250)).toBeNull();
    expect(alarms.nextAtMs()).toBe(300);
  });

  it('takes an alarm that is due exactly now', () => {
    const alarms = new WakeAlarms();
    alarms.set(1, 100);
    expect(alarms.takeDue(100)).toEqual({ id: 1, atMs: 100 });
  });

  it('replaces the time of an id that is armed again', () => {
    const alarms = new WakeAlarms();
    alarms.set(1, 100);
    alarms.set(1, 500);
    expect(alarms.nextAtMs()).toBe(500);
    expect(alarms.takeDue(200)).toBeNull();
    expect(alarms.takeDue(500)).toEqual({ id: 1, atMs: 500 });
    expect(alarms.nextAtMs()).toBeNull();
  });

  it('deletes an id, and ignores one that is not armed', () => {
    const alarms = new WakeAlarms();
    alarms.set(1, 100);
    alarms.set(2, 200);
    alarms.delete(1);
    alarms.delete(9);
    expect(alarms.nextAtMs()).toBe(200);
  });

  it('refuses a new id at capacity but still re-arms an armed one', () => {
    const alarms = new WakeAlarms();
    for (let id = 1; id <= MAX_WAKE_ALARMS; id++) {
      expect(alarms.set(id, id * 10)).toBe(true);
    }
    expect(alarms.set(MAX_WAKE_ALARMS + 1, 1)).toBe(false);
    expect(alarms.nextAtMs()).toBe(10);
    expect(alarms.set(1, 999)).toBe(true);
    expect(alarms.nextAtMs()).toBe(20);

    alarms.delete(2);
    expect(alarms.set(MAX_WAKE_ALARMS + 1, 1)).toBe(true);
  });

  it('breaks a tie in the order armed', () => {
    const alarms = new WakeAlarms();
    alarms.set(5, 100);
    alarms.set(4, 100);
    expect(alarms.takeDue(100)?.id).toBe(5);
    expect(alarms.takeDue(100)?.id).toBe(4);
  });

  it('reuses one object for what it hands back', () => {
    const alarms = new WakeAlarms();
    alarms.set(1, 10);
    alarms.set(2, 20);
    const first = alarms.takeDue(100);
    const second = alarms.takeDue(100);
    expect(second).toBe(first);
  });
});
