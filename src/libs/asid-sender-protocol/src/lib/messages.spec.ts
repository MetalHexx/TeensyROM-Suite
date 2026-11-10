import {
  ASID_SENDER_IDENTITY,
  ASID_SENDER_PROTOCOL_VERSION,
  isAppToSender,
  isConnectMessage,
  isSenderToApp,
} from './messages';
import type { SenderTimingReport } from './timing-report';

const sysex = (...inner: number[]) => new Uint8Array([0xf0, ...inner, 0xf7]);

const report: SenderTimingReport = {
  sinceS: 12.5,
  marginMs: { now: 3, max: 7.5 },
  wake: { count: 10, p50: 0.4, p99: 2.1, max: 3 },
  cartridges: [
    {
      token: '1234',
      packets: 100,
      arrival: { pastDue: 1, pastDueMaxMs: 2, spareMinMs: 0.5, spareP1Ms: 1, spareP50Ms: 30 },
      send: {
        count: 100,
        p50: 0.1,
        p99: 1,
        max: 2,
        ownOver2Ms: 0,
        ownOver5Ms: 0,
        ownMaxMs: 1,
      },
      gaps: { medianMs: 20, within1MsPct: 99, offOver5Ms: 0 },
      failedSends: 0,
      dropped: 0,
    },
  ],
  timeline: [
    {
      atS: 0,
      visibility: 'visible',
      marginMaxMs: 3,
      wakeMaxMs: 1,
      cartridges: [
        { token: '1234', packets: 50, pastDue: 0, lateMaxMs: 1, ownMaxMs: 1, within1MsPct: 100 },
      ],
    },
  ],
  visibility: [{ atS: 0, state: 'visible' }],
  appQuietMaxMs: 40,
};

describe('isConnectMessage', () => {
  it('accepts a connect message', () => {
    expect(
      isConnectMessage({
        k: 'connect',
        identity: ASID_SENDER_IDENTITY,
        version: ASID_SENDER_PROTOCOL_VERSION,
      })
    ).toBe(true);
  });

  it.each([
    undefined,
    null,
    'connect',
    42,
    [],
    {},
    { k: 'connect' },
    { k: 'connect', identity: 5, version: 1 },
    { k: 'connect', identity: 'x', version: '1' },
    { k: 'connect', identity: 'x', version: NaN },
    { k: 'hello', identity: 'x', version: 1 },
  ])('rejects %j', (value) => {
    expect(isConnectMessage(value)).toBe(false);
  });
});

describe('isAppToSender', () => {
  it('accepts every message kind', () => {
    const messages = [
      { k: 'packet', token: '1234', bytes: sysex(1, 2, 3), due: 1500.5 },
      { k: 'packet', token: 'a-b_C', bytes: sysex(0), due: null },
      { k: 'ping', seq: 3 },
      { k: 'test-arm', id: 1 },
      { k: 'test-end', id: 1, holdStart: 10, holdEnd: 20 },
      { k: 'timing', id: 2 },
      { k: 'timing-clear' },
    ];
    for (const message of messages) {
      expect(isAppToSender(message)).toBe(true);
    }
  });

  describe('wake kinds', () => {
    it('accepts a wake request and a cancel', () => {
      expect(isAppToSender({ k: 'wake-at', id: 1, at: 1_700_000_000_123.5 })).toBe(true);
      expect(isAppToSender({ k: 'wake-at', id: 3, at: -5 })).toBe(true);
      expect(isAppToSender({ k: 'wake-cancel', id: 7 })).toBe(true);
    });

    it.each([0, -1, 1.5, NaN, Infinity, '1', undefined, Number.MAX_SAFE_INTEGER + 1])(
      'rejects the id %j',
      (id) => {
        expect(isAppToSender({ k: 'wake-at', id, at: 5 })).toBe(false);
        expect(isAppToSender({ k: 'wake-cancel', id })).toBe(false);
        expect(isSenderToApp({ k: 'wake', id, at: 5, t: 6 })).toBe(false);
      }
    );

    it.each([NaN, Infinity, -Infinity, '5', undefined, null])('rejects the time %j', (time) => {
      expect(isAppToSender({ k: 'wake-at', id: 1, at: time })).toBe(false);
      expect(isSenderToApp({ k: 'wake', id: 1, at: time, t: 6 })).toBe(false);
      expect(isSenderToApp({ k: 'wake', id: 1, at: 5, t: time })).toBe(false);
    });

    it('accepts a wake from the sender', () => {
      expect(isSenderToApp({ k: 'wake', id: 2, at: 10.5, t: 11 })).toBe(true);
    });
  });

  describe('packets', () => {
    const packet = (changes: Record<string, unknown>) => ({
      k: 'packet',
      token: '1234',
      bytes: sysex(1, 2),
      due: null,
      ...changes,
    });

    it('rejects bytes that are not SysEx', () => {
      expect(isAppToSender(packet({ bytes: new Uint8Array([0x90, 1, 2, 3]) }))).toBe(false);
      expect(isAppToSender(packet({ bytes: new Uint8Array([0xf0, 1, 2, 3]) }))).toBe(false);
      expect(isAppToSender(packet({ bytes: new Uint8Array([1, 2, 3, 0xf7]) }))).toBe(false);
    });

    it('rejects packets that are too short or too long', () => {
      expect(isAppToSender(packet({ bytes: new Uint8Array([0xf0, 0xf7]) }))).toBe(false);
      const longest = new Uint8Array(1024);
      longest[0] = 0xf0;
      longest[1023] = 0xf7;
      expect(isAppToSender(packet({ bytes: longest }))).toBe(true);
      const tooLong = new Uint8Array(1025);
      tooLong[0] = 0xf0;
      tooLong[1024] = 0xf7;
      expect(isAppToSender(packet({ bytes: tooLong }))).toBe(false);
    });

    it('rejects bytes that are not a Uint8Array', () => {
      expect(isAppToSender(packet({ bytes: [0xf0, 1, 0xf7] }))).toBe(false);
      expect(isAppToSender(packet({ bytes: new Uint16Array([0xf0, 1, 0xf7]) }))).toBe(false);
      expect(isAppToSender(packet({ bytes: undefined }))).toBe(false);
    });

    it('rejects a due time that is neither null nor finite', () => {
      expect(isAppToSender(packet({ due: NaN }))).toBe(false);
      expect(isAppToSender(packet({ due: Infinity }))).toBe(false);
      expect(isAppToSender(packet({ due: undefined }))).toBe(false);
      expect(isAppToSender(packet({ due: '5' }))).toBe(false);
    });

    it('rejects a token that does not match the token pattern', () => {
      expect(isAppToSender(packet({ token: '' }))).toBe(false);
      expect(isAppToSender(packet({ token: 'TeensyROM 1' }))).toBe(false);
      expect(isAppToSender(packet({ token: 12 }))).toBe(false);
    });
  });

  it.each([
    undefined,
    null,
    7,
    'ping',
    [],
    {},
    { k: 'nope' },
    { k: 'ping' },
    { k: 'ping', seq: 'x' },
    { k: 'test-arm' },
    { k: 'test-end', id: 1, holdStart: 1 },
    { k: 'test-end', id: 1, holdStart: NaN, holdEnd: 2 },
    { k: 'timing', id: Infinity },
    { k: 'hello', identity: 'x', version: 1 },
  ])('rejects %j', (value) => {
    expect(isAppToSender(value)).toBe(false);
  });
});

describe('isSenderToApp', () => {
  it('accepts every message kind', () => {
    const messages = [
      { k: 'hello', identity: ASID_SENDER_IDENTITY, version: 1 },
      { k: 'ready', midi: true },
      { k: 'ready', midi: false, error: 'SecurityError: denied' },
      { k: 'outputs', tokens: ['1234', 'abcd'] },
      { k: 'outputs', tokens: [] },
      { k: 'pong', seq: 1 },
      { k: 'test-armed', id: 1 },
      { k: 'test-result', id: 1, turns: 0 },
      { k: 'timing', id: 4, report },
      { k: 'fault', fault: 'midi-lost', detail: 'denied' },
      { k: 'fault', fault: 'send-failed', token: '1234', detail: 'boom' },
    ];
    for (const message of messages) {
      expect(isSenderToApp(message)).toBe(true);
    }
  });

  it.each([
    undefined,
    null,
    'hello',
    [],
    {},
    { k: 'ready' },
    { k: 'ready', midi: 'yes' },
    { k: 'ready', midi: false, error: 5 },
    { k: 'outputs', tokens: 'abc' },
    { k: 'outputs', tokens: ['ok', 7] },
    { k: 'outputs', tokens: ['has space'] },
    { k: 'pong' },
    { k: 'test-result', id: 1 },
    { k: 'timing', id: 1 },
    { k: 'timing', id: 1, report: {} },
    { k: 'timing', id: 1, report: { ...report, cartridges: [{ token: 'x' }] } },
    { k: 'timing', id: 1, report: { ...report, timeline: [null] } },
    { k: 'timing', id: 1, report: { ...report, visibility: [{ atS: 0, state: 'asleep' }] } },
    { k: 'fault', fault: 'exploded', detail: 'x' },
    { k: 'fault', fault: 'midi-lost' },
    { k: 'fault', fault: 'send-failed', token: 5, detail: 'x' },
    { k: 'packet', token: '1234', bytes: sysex(1), due: null },
  ])('rejects %j', (value) => {
    expect(isSenderToApp(value)).toBe(false);
  });

  it('survives a report that cloned through a channel', () => {
    expect(isSenderToApp(structuredClone({ k: 'timing', id: 1, report }))).toBe(true);
  });
});
