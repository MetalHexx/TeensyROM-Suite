import { isTeensyRomToken, teensyRomToken } from './teensyrom-token';

describe('teensyRomToken', () => {
  it.each([
    ['TeensyROM-1234', '1234'],
    ['MIDIOUT2 (TeensyROM-ab_C-9)', 'ab_C-9'],
    ['TeensyROM-1234 Port 2', '1234'],
  ])('reads the id from %j', (name, token) => {
    expect(teensyRomToken(name)).toBe(token);
  });

  it.each(['', 'TeensyROM', 'TeensyROM-', 'Some Other Synth', 'teensyrom-1234'])(
    'is null for %j',
    (name) => {
      expect(teensyRomToken(name)).toBeNull();
    }
  );
});

describe('isTeensyRomToken', () => {
  it('accepts what teensyRomToken can produce', () => {
    expect(isTeensyRomToken('1234')).toBe(true);
    expect(isTeensyRomToken('a_B-9')).toBe(true);
  });

  it.each(['', 'a b', 'a/b', '12\n34', 5, null, undefined, {}])('rejects %j', (value) => {
    expect(isTeensyRomToken(value)).toBe(false);
  });
});
