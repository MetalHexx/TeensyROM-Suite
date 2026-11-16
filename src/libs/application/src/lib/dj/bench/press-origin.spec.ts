import { describe, expect, it } from 'vitest';
import { PressOrigin } from './press-origin';

describe('PressOrigin', () => {
  it('starts a press at now when no controller message is being handled', () => {
    const origin = new PressOrigin();

    expect(origin.startMs(500)).toBe(500);
    expect(origin.fromController(500)).toBe(false);
  });

  it('starts a press at the arrival of the message being handled', () => {
    const origin = new PressOrigin();

    origin.begin(470);

    expect(origin.startMs(500)).toBe(470);
    expect(origin.fromController(500)).toBe(true);
  });

  it('goes back to now once the message is handled', () => {
    const origin = new PressOrigin();
    origin.begin(470);

    origin.end();

    expect(origin.startMs(600)).toBe(600);
    expect(origin.fromController(600)).toBe(false);
  });

  it.each([
    ['zero', 0],
    ['in the future', 501],
    ['negative', -5],
  ])(
    'starts at now when the arrival is %s, as from a port that does not stamp',
    (_why, arrived) => {
      const origin = new PressOrigin();

      origin.begin(arrived);

      expect(origin.startMs(500)).toBe(500);
      expect(origin.fromController(500)).toBe(false);
    }
  );
});
