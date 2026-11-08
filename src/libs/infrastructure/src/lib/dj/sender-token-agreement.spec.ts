import { describe, it, expect } from 'vitest';
import { midiPortDeviceToken } from '@teensyrom-nx/domain';
import { teensyRomToken } from '@teensyrom-nx/asid-sender-protocol';

// The sender page names cartridges with the protocol library's token and the app with domain's; the
// two are separate copies of one rule and must keep agreeing.
describe('port name token', () => {
  it.each([
    'TeensyROM-12345',
    'TeensyROM-1234 MIDI 1',
    'USB MIDI Device',
    'Not-TeensyROM',
    'teensyrom-999',
    'TeensyROM-',
    'xTeensyROM-abc_9-z',
  ])('is the same in the sender protocol and in domain for %j', (name) => {
    expect(teensyRomToken(name)).toBe(midiPortDeviceToken(name));
  });
});
