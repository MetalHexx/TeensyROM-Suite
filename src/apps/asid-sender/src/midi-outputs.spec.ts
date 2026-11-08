import type { SenderToApp } from '@teensyrom-nx/asid-sender-protocol';
import {
  FAULT_EVERY_MS,
  MidiOutputs,
  teensyRomOutputs,
  type MidiAccessLike,
  type MidiOutputLike,
} from './midi-outputs';

const BYTES = new Uint8Array([0xf0, 1, 0xf7]);

type FakeOutput = MidiOutputLike & { sent: Uint8Array[]; failWith?: Error };

function output(name: string | null, state?: string): FakeOutput {
  const self: FakeOutput = {
    name,
    state,
    sent: [],
    send(data) {
      if (self.failWith) {
        throw self.failWith;
      }
      self.sent.push(data);
    },
  };
  return self;
}

describe('teensyRomOutputs', () => {
  it('maps each output by the token in its name', () => {
    const a = output('MIDIOUT2 (TeensyROM-1234)');
    const b = output('TeensyROM-abcd', 'connected');
    const c = output('TeensyROM-ef01');
    const map = teensyRomOutputs([a, b, c]);
    expect([...map.keys()]).toEqual(['1234', 'abcd', 'ef01']);
    expect(map.get('1234')).toBe(a);
  });

  it('skips names with no token', () => {
    const map = teensyRomOutputs([
      output('Microsoft GS Wavetable Synth'),
      output(null),
      output('TeensyROM-'),
    ]);
    expect(map.size).toBe(0);
  });

  it('skips disconnected outputs', () => {
    const map = teensyRomOutputs([
      output('TeensyROM-1234', 'disconnected'),
      output('TeensyROM-abcd', 'connected'),
    ]);
    expect([...map.keys()]).toEqual(['abcd']);
  });
});

describe('MidiOutputs', () => {
  function rig() {
    const clock = { t: 0 };
    const posted: SenderToApp[] = [];
    const ports = [output('TeensyROM-1234'), output('TeensyROM-abcd'), output('Some Synth')];
    const hooks: { onChange: () => void; onPermission: (state: string) => void } = {
      onChange: () => undefined,
      onPermission: () => undefined,
    };
    const midi = new MidiOutputs({
      requestAccess: async (): Promise<MidiAccessLike> => ({
        outputs: () => ports,
        onChange: (listener) => {
          hooks.onChange = listener;
        },
      }),
      watchPermission: (listener) => {
        hooks.onPermission = listener;
      },
      post: (message) => posted.push(message),
      now: () => clock.t,
    });
    return { clock, posted, ports, hooks, midi };
  }

  it('posts the outputs it lists, then says ready', async () => {
    const r = rig();
    await r.midi.start();
    expect(r.posted).toEqual([
      { k: 'outputs', tokens: ['1234', 'abcd'] },
      { k: 'ready', midi: true },
    ]);
    expect(r.midi.lists('1234')).toBe(true);
    expect(r.midi.lists('ffff')).toBe(false);
  });

  it('says ready with midi false and the error text when access is refused', async () => {
    const posted: SenderToApp[] = [];
    const midi = new MidiOutputs({
      requestAccess: () => Promise.reject(new DOMException('Permission denied', 'SecurityError')),
      watchPermission: () => undefined,
      post: (message) => posted.push(message),
      now: () => 0,
    });
    await midi.start();
    expect(posted).toEqual([
      { k: 'ready', midi: false, error: 'SecurityError: Permission denied' },
    ]);
  });

  it('posts outputs on a state change only when the sorted list of tokens changed', async () => {
    const r = rig();
    await r.midi.start();
    r.posted.length = 0;

    r.hooks.onChange(); // nothing changed
    expect(r.posted).toEqual([]);

    r.ports.push(output('TeensyROM-0001'));
    r.hooks.onChange();
    expect(r.posted).toEqual([{ k: 'outputs', tokens: ['0001', '1234', 'abcd'] }]);

    r.posted.length = 0;
    r.ports.reverse(); // same ports, another order
    r.hooks.onChange();
    expect(r.posted).toEqual([]);

    r.ports[r.ports.findIndex((p) => p.name === 'TeensyROM-1234')] = output(
      'TeensyROM-1234',
      'disconnected'
    );
    r.hooks.onChange();
    expect(r.posted).toEqual([{ k: 'outputs', tokens: ['0001', 'abcd'] }]);
    expect(r.midi.lists('1234')).toBe(false);
  });

  it('posts midi-lost when the permission changes to anything but granted', async () => {
    const r = rig();
    await r.midi.start();
    r.posted.length = 0;
    r.hooks.onPermission('granted');
    expect(r.posted).toEqual([]);
    r.hooks.onPermission('denied');
    expect(r.posted).toEqual([
      { k: 'fault', fault: 'midi-lost', detail: 'MIDI permission is denied' },
    ]);
  });

  describe('sending', () => {
    it("sends the bytes to the cartridge's output", async () => {
      const r = rig();
      await r.midi.start();
      expect(r.midi.send('abcd', BYTES)).toBe('sent');
      expect(r.ports[1].sent).toEqual([BYTES]);
    });

    it('does not send to a token it does not list', async () => {
      const r = rig();
      await r.midi.start();
      expect(r.midi.send('ffff', BYTES)).toBe('unlisted');
    });

    it('counts a throwing send as failed for that cartridge only, and the other carries on', async () => {
      const r = rig();
      await r.midi.start();
      r.ports[0].failWith = new Error('port closed');
      r.posted.length = 0;

      expect(r.midi.send('1234', BYTES)).toBe('failed');
      expect(r.midi.send('abcd', BYTES)).toBe('sent');
      expect(r.posted).toEqual([
        { k: 'fault', fault: 'send-failed', token: '1234', detail: 'Error: port closed' },
      ]);
    });

    it('reports a failing cartridge at most once a second', async () => {
      const r = rig();
      await r.midi.start();
      r.ports[0].failWith = new Error('port closed');
      r.ports[1].failWith = new Error('port closed');
      r.posted.length = 0;

      for (let i = 0; i < 30; i++) {
        r.clock.t = i * 20; // 0 to 580 ms
        r.midi.send('1234', BYTES);
      }
      r.midi.send('abcd', BYTES); // a different cartridge has its own second
      expect(r.posted.map((m) => (m.k === 'fault' ? m.token : null))).toEqual(['1234', 'abcd']);

      r.clock.t = FAULT_EVERY_MS;
      r.midi.send('1234', BYTES);
      expect(r.posted).toHaveLength(3);
    });
  });
});
