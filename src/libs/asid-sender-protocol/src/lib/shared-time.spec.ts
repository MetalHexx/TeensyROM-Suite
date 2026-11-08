import { fromSharedTime, toSharedTime } from './shared-time';

describe('shared time', () => {
  it('puts a page-local reading on the shared clock and back', () => {
    const origin = 1_730_000_000_123.456;
    const local = 4321.5;
    const shared = toSharedTime(local, origin);
    expect(shared).toBe(origin + local);
    expect(fromSharedTime(shared, origin)).toBeCloseTo(local, 6);
  });

  it('maps the same instant from two pages with different origins to one shared time', () => {
    const senderOrigin = 1_000_000;
    const appOrigin = 1_000_250;
    expect(toSharedTime(500, senderOrigin)).toBe(toSharedTime(250, appOrigin));
  });
});
