import { ReleaseQueue } from './release-queue';

const bytes = (id: number) => new Uint8Array([0xf0, id, 0xf7]);
const idOf = (packet: { bytes: Uint8Array } | null) => packet?.bytes[1];

function drain(queue: ReleaseQueue, nowMs: number): number[] {
  const ids: number[] = [];
  for (let held = queue.takeDue(nowMs); held; held = queue.takeDue(nowMs)) {
    ids.push(held.bytes[1]);
  }
  return ids;
}

describe('ReleaseQueue', () => {
  it('holds a packet until its time and then releases it', () => {
    const queue = new ReleaseQueue();
    queue.enqueue('a', bytes(1), 150, 100);
    expect(queue.size).toBe(1);
    expect(queue.nextAtMs()).toBe(150);
    expect(queue.takeDue(149.9)).toBeNull();
    expect(idOf(queue.takeDue(150))).toBe(1);
    expect(queue.size).toBe(0);
    expect(queue.nextAtMs()).toBeNull();
  });

  it('keeps a cartridge in arrival order, even when a later packet is due sooner', () => {
    const queue = new ReleaseQueue();
    queue.enqueue('a', bytes(1), 200, 100);
    queue.enqueue('a', bytes(2), 150, 101);
    expect(drain(queue, 300)).toEqual([1, 2]);
  });

  it("lands a packet with no due time behind that cartridge's held frames", () => {
    const queue = new ReleaseQueue();
    queue.enqueue('a', bytes(1), 200, 100);
    queue.enqueue('a', bytes(2), null, 101);
    expect(queue.nextAtMs()).toBe(200);
    expect(drain(queue, 199)).toEqual([]);
    expect(drain(queue, 200)).toEqual([1, 2]);
  });

  it('releases a packet with no due time at once when the cartridge holds nothing', () => {
    const queue = new ReleaseQueue();
    queue.enqueue('a', bytes(1), null, 100);
    expect(idOf(queue.takeDue(100))).toBe(1);
  });

  it('keeps arrival order for equal due times, across cartridges too', () => {
    const queue = new ReleaseQueue();
    queue.enqueue('a', bytes(1), 200, 100);
    queue.enqueue('b', bytes(2), 200, 100);
    queue.enqueue('a', bytes(3), 200, 100);
    queue.enqueue('b', bytes(4), 200, 100);
    expect(drain(queue, 200)).toEqual([1, 2, 3, 4]);
  });

  it('interleaves two cartridges by time', () => {
    const queue = new ReleaseQueue();
    queue.enqueue('a', bytes(1), 120, 100);
    queue.enqueue('b', bytes(2), 110, 100);
    queue.enqueue('a', bytes(3), 140, 100);
    queue.enqueue('b', bytes(4), 130, 100);
    expect(drain(queue, 1000)).toEqual([2, 1, 4, 3]);
  });

  it('does not hold one cartridge behind the other', () => {
    const queue = new ReleaseQueue();
    queue.enqueue('a', bytes(1), 500, 100);
    queue.enqueue('b', bytes(2), 120, 100);
    expect(drain(queue, 130)).toEqual([2]);
    expect(queue.size).toBe(1);
  });

  it('is due at once for a packet that arrived past due, and records how late it came', () => {
    const queue = new ReleaseQueue();
    queue.enqueue('a', bytes(1), 90, 100);
    const held = queue.takeDue(100);
    expect(held?.atMs).toBe(90);
    expect(held?.leadMs).toBe(-10);
    expect(held?.stamped).toBe(true);
  });

  it('records the lead of an on-time stamped packet and marks a now-packet unstamped', () => {
    const queue = new ReleaseQueue();
    queue.enqueue('a', bytes(1), 130, 100);
    queue.enqueue('b', bytes(2), null, 100);
    const first = queue.takeDue(100);
    const second = queue.takeDue(130);
    expect(first).toMatchObject({ token: 'b', stamped: false, leadMs: 0, atMs: 100 });
    expect(second).toMatchObject({ token: 'a', stamped: true, leadMs: 30, atMs: 130 });
  });

  it('puts a past-due packet ahead of later held frames of another cartridge', () => {
    const queue = new ReleaseQueue();
    queue.enqueue('a', bytes(1), 150, 100);
    queue.enqueue('b', bytes(2), 95, 100);
    expect(drain(queue, 100)).toEqual([2]);
  });

  it('lets a late packet follow a past-due one of the same cartridge without overtaking it', () => {
    const queue = new ReleaseQueue();
    queue.enqueue('a', bytes(1), 95, 100);
    queue.enqueue('a', bytes(2), 90, 100);
    expect(drain(queue, 100)).toEqual([1, 2]);
  });
});
