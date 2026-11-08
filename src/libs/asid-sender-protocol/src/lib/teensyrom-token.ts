const MIDI_PORT_TOKEN = /TeensyROM-([A-Za-z0-9_-]+)/;
const TOKEN = /^[A-Za-z0-9_-]+$/;

/**
 * The id after "TeensyROM-" in a MIDI port name — the chip ID of the cartridge behind the port —
 * or `null` when the name carries none. Same pattern as domain's `midiPortDeviceToken`: change
 * both together.
 */
export function teensyRomToken(portName: string): string | null {
  return MIDI_PORT_TOKEN.exec(portName)?.[1] ?? null;
}

/** True when `value` is a string `teensyRomToken` could have produced. */
export function isTeensyRomToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value);
}
