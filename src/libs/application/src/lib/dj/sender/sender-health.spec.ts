import { describe, it, expect } from 'vitest';
import {
  ASID_SENDER_IDENTITY,
  ASID_SENDER_PROTOCOL_VERSION,
  SENDER_TICK_MS,
} from '@teensyrom-nx/asid-sender-protocol';
import {
  HEALTH_TIMEOUT_MS,
  HELLO_TIMEOUT_MS,
  LOAD_TIMEOUT_MS,
  MIDI_TIMEOUT_MS,
  RETRY_DELAYS_MS,
  SenderHealth,
  START_GRACE_MS,
  STALL_GAP_MS,
  TICK_MS,
  type SenderCommand,
  type SenderHealthEvent,
} from './sender-health';

/** A machine on a fake clock. `tick` advances 250 ms, the link's own cadence, and by default the
 *  sender answers the ping straight after. */
function harness() {
  const health = new SenderHealth();
  let now = 1000;
  const all: SenderCommand[] = [];

  const feed = (event: SenderHealthEvent): readonly SenderCommand[] => {
    const commands = health.handle(event, now);
    all.push(...commands);
    return commands;
  };

  const tick = (options: { decksPlaying?: boolean; pong?: boolean } = {}) => {
    now += TICK_MS;
    const commands = feed({ kind: 'tick', decksPlaying: options.decksPlaying ?? false });
    if (options.pong ?? true) {
      feed({ kind: 'pong' });
    }
    return commands;
  };

  /** Ticks for `ms`, returning every command they gave. */
  const run = (ms: number, options: { decksPlaying?: boolean; pong?: boolean } = {}) => {
    const commands: SenderCommand[] = [];
    for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
      commands.push(...tick(options));
    }
    return commands;
  };

  const advance = (ms: number) => {
    now += ms;
  };

  const sayHello = () =>
    feed({
      kind: 'hello',
      identity: ASID_SENDER_IDENTITY,
      version: ASID_SENDER_PROTOCOL_VERSION,
    });

  /** The frame loads, says hello and reports MIDI up. */
  const frameComesUp = () => {
    feed({ kind: 'loaded' });
    sayHello();
    return feed({ kind: 'ready', midi: true });
  };

  const grant = () => feed({ kind: 'midi-granted', senderAddress: true });

  /** From idle to `up`, the own-thread test passed. */
  const bringUp = () => {
    grant();
    frameComesUp();
    tick();
    feed({ kind: 'self-test', result: 'passed' });
  };

  return {
    health,
    all,
    feed,
    tick,
    run,
    advance,
    sayHello,
    frameComesUp,
    grant,
    bringUp,
    now: () => now,
  };
}

type Harness = ReturnType<typeof harness>;

/** The commands as short names, for reading an order. */
function names(commands: readonly SenderCommand[]): string[] {
  return commands.map((command) => {
    switch (command.kind) {
      case 'route':
        return `route:${command.path}`;
      case 'alert':
        return `alert:${command.alert}`;
      default:
        return command.kind;
    }
  });
}

function alerts(commands: readonly SenderCommand[]): string[] {
  return names(commands).filter((name) => name.startsWith('alert:'));
}

/** Ticks until the machine reopens the frame and returns everything the ticks gave. */
function untilOpen(m: Harness): SenderCommand[] {
  const commands: SenderCommand[] = [];
  for (let waited = 0; waited < 60_000; waited += TICK_MS) {
    const tick = m.tick();
    commands.push(...tick);
    if (names(tick).includes('open')) {
      return commands;
    }
  }
  throw new Error('the machine never reopened');
}

/** Fails the open frame on purpose and returns how long the machine waited before reopening. */
function failAndWaitForRetry(m: Harness): number {
  const failedAt = m.now();
  m.feed({ kind: 'break' });
  untilOpen(m);
  return m.now() - failedAt;
}

describe('SenderHealth', () => {
  describe('before MIDI is granted', () => {
    it('ignores everything and emits nothing', () => {
      const m = harness();
      const events: SenderHealthEvent[] = [
        { kind: 'tick', decksPlaying: false },
        { kind: 'loaded' },
        { kind: 'pong' },
        { kind: 'ready', midi: true },
        { kind: 'fault', fault: 'midi-lost', detail: 'x' },
        { kind: 'self-test', result: 'passed' },
      ];

      for (const event of events) {
        expect(m.feed(event)).toEqual([]);
      }

      expect(m.health.state).toBe('idle');
    });
  });

  describe('an address with no other local name', () => {
    it('warns once, never opens, and then emits nothing more', () => {
      const m = harness();

      const commands = m.feed({ kind: 'midi-granted', senderAddress: false });
      const later = [
        ...m.run(60_000),
        ...m.feed({ kind: 'midi-granted', senderAddress: true }),
        ...m.sayHello(),
      ];

      expect(alerts(commands)).toEqual(['alert:unavailable']);
      expect(names(commands)).not.toContain('open');
      expect(later).toEqual([]);
      expect(m.health.state).toBe('unavailable');
    });
  });

  describe('opening', () => {
    it('starts the link and opens the frame when MIDI is granted with an address', () => {
      const m = harness();

      const commands = m.grant();

      expect(names(commands)).toEqual(['start-link', 'open', 'log']);
      expect(m.health.state).toBe('opening');
    });

    it('logs every state change with the old state, the new state and the reason', () => {
      const m = harness();

      const messages = m.grant().flatMap((command) => (command.kind === 'log' ? [command.message] : []));

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatch(/idle.*opening/);
    });

    it('fails a hello with the wrong identity', () => {
      const m = harness();
      m.grant();
      m.feed({ kind: 'loaded' });

      const commands = m.feed({
        kind: 'hello',
        identity: 'something-else',
        version: ASID_SENDER_PROTOCOL_VERSION,
      });

      expect(names(commands)).toEqual(['close', 'log']);
      expect(m.health.state).toBe('down');
    });

    it('fails a hello from a sender page still on protocol version 1', () => {
      const m = harness();
      m.grant();
      m.feed({ kind: 'loaded' });

      m.feed({ kind: 'hello', identity: ASID_SENDER_IDENTITY, version: 1 });

      expect(m.health.state).toBe('down');
    });

    it('fails a hello with the wrong protocol version', () => {
      const m = harness();
      m.grant();
      m.feed({ kind: 'loaded' });

      m.feed({ kind: 'hello', identity: ASID_SENDER_IDENTITY, version: ASID_SENDER_PROTOCOL_VERSION + 1 });

      expect(m.health.state).toBe('down');
    });

    it('fails a ready that says MIDI did not start', () => {
      const m = harness();
      m.grant();
      m.feed({ kind: 'loaded' });
      m.sayHello();

      const commands = m.feed({ kind: 'ready', midi: false, error: 'no access' });

      expect(names(commands)).toEqual(['close', 'log']);
      expect((commands[1] as { message: string }).message).toContain('no access');
      expect(m.health.state).toBe('down');
    });

    it('fails a page that loads and never says hello, within a second of steady time', () => {
      const m = harness();
      m.grant();
      m.feed({ kind: 'loaded' });

      expect(m.run(HELLO_TIMEOUT_MS - TICK_MS)).toEqual([]);
      expect(m.health.state).toBe('opening');

      const commands = m.tick();

      expect(names(commands)).toEqual(['close', 'log']);
      expect(m.health.state).toBe('down');
    });

    it('fails a page that loads just after a tick and never says hello within a second of loading', () => {
      const m = harness();
      m.grant();
      m.tick();
      m.advance(1);
      m.feed({ kind: 'loaded' });
      const loadedAt = m.now();
      m.advance(-1); // the next tick lands 249 ms after the load: the worst case on a 250 ms grid

      let noticedAfter: number | null = null;
      for (let waited = 0; waited < 2000 && noticedAfter === null; waited += TICK_MS) {
        if (m.tick().length > 0) {
          noticedAfter = m.now() - loadedAt;
        }
      }

      expect(noticedAfter).not.toBeNull();
      expect(noticedAfter).toBeLessThan(1000);
    });

    it('fails a hello that never gets a ready only after the MIDI timeout', () => {
      const m = harness();
      m.grant();
      m.feed({ kind: 'loaded' });
      m.sayHello();

      expect(m.run(MIDI_TIMEOUT_MS - TICK_MS)).toEqual([]);
      expect(m.health.state).toBe('opening');

      m.tick();
      expect(m.health.state).toBe('down');
    });

    it('fails a frame that never loads only after the load timeout', () => {
      const m = harness();
      m.grant();

      expect(m.run(LOAD_TIMEOUT_MS - TICK_MS)).toEqual([]);
      expect(m.health.state).toBe('opening');

      m.tick();
      expect(m.health.state).toBe('down');
    });

    it('does not count time the page itself stalled', () => {
      const m = harness();
      m.grant();
      m.feed({ kind: 'loaded' });
      m.run(500);

      m.advance(5000);
      const afterStall = m.tick();
      const soon = m.run(HELLO_TIMEOUT_MS - TICK_MS - TICK_MS);

      expect(afterStall).toEqual([]);
      expect(soon).toEqual([]);
      expect(m.health.state).toBe('opening');
    });
  });

  describe('the pong clock of a new frame', () => {
    it('is judged against the new frame after a first open', () => {
      const m = harness();
      m.grant();
      m.run(1750, { pong: false });

      m.frameComesUp();
      m.tick({ pong: false });

      expect(m.health.state).toBe('testing');
    });

    it('is judged against the new frame after a retry', () => {
      const m = harness();
      m.grant();
      failAndWaitForRetry(m);
      m.run(1750, { pong: false });

      m.frameComesUp();
      m.tick({ pong: false });

      expect(m.health.state).toBe('testing');
    });

    it('is judged against the new frame after a reopen from the dev flip', () => {
      const m = harness();
      m.bringUp();
      m.feed({ kind: 'prefer', path: 'mixer' });
      m.run(5000);
      m.feed({ kind: 'prefer', path: 'sender' });
      m.run(1750, { pong: false });

      m.frameComesUp();
      m.tick({ pong: false });

      expect(m.health.state).toBe('up');
    });
  });

  describe('the own-thread test', () => {
    function testing(): Harness {
      const m = harness();
      m.grant();
      m.frameComesUp();
      return m;
    }

    it('is asked on the first tick with no deck playing, and only one at a time', () => {
      const m = testing();

      expect(names(m.tick({ decksPlaying: true }))).toEqual([]);
      expect(names(m.tick({ decksPlaying: false }))).toEqual(['self-test']);
      expect(names(m.tick({ decksPlaying: false }))).toEqual([]);
    });

    it('asks again on a later idle tick after an abort', () => {
      const m = testing();
      m.tick();
      m.feed({ kind: 'self-test', result: 'aborted' });

      expect(m.health.state).toBe('testing');
      expect(names(m.tick({ decksPlaying: true }))).toEqual([]);
      expect(names(m.tick({ decksPlaying: false }))).toEqual(['self-test']);
    });

    it('routes the decks to the sender when it passes', () => {
      const m = testing();
      m.tick();

      const commands = m.feed({ kind: 'self-test', result: 'passed' });

      expect(names(commands)).toEqual(['route:sender', 'log']);
      expect(m.health.state).toBe('up');
      expect(m.health.path).toBe('sender');
    });

    it('warns once and closes for good when it fails', () => {
      const m = testing();
      m.tick();

      const commands = m.feed({ kind: 'self-test', result: 'failed' });
      const later = m.run(120_000);

      expect(names(commands)).toEqual(['close', 'log', 'alert:unavailable']);
      expect(m.health.state).toBe('unavailable');
      expect(later).toEqual([]);
    });

    it('is asked again for a sender that failed before its test passed', () => {
      const m = testing();
      m.tick();
      m.feed({ kind: 'break' });
      expect(m.health.state).toBe('down');

      untilOpen(m);
      const ready = m.frameComesUp();

      expect(names(ready)).not.toContain('route:sender');
      expect(m.health.state).toBe('testing');
      expect(names(m.tick())).toEqual(['self-test']);
    });

    it('is not asked again once it has passed', () => {
      const m = harness();
      m.bringUp();
      m.feed({ kind: 'break' });
      untilOpen(m);

      const ready = m.frameComesUp();

      expect(names(ready)).toEqual(['route:sender', 'log']);
      expect(m.health.state).toBe('up');
    });
  });

  describe('health', () => {
    it('fails by the tick that first reaches the timeout of steady silence', () => {
      const m = harness();
      m.bringUp();

      expect(m.run(HEALTH_TIMEOUT_MS - TICK_MS, { pong: false })).toEqual([]);
      expect(m.health.state).toBe('up');

      m.tick({ pong: false });
      expect(m.health.state).toBe('down');
    });

    it('is judged in testing as it is in up', () => {
      const m = harness();
      m.grant();
      m.frameComesUp();

      m.run(HEALTH_TIMEOUT_MS, { pong: false, decksPlaying: true });

      expect(m.health.state).toBe('down');
    });

    it('never fails on a long gap between ticks, during missing pongs or after them', () => {
      const m = harness();
      m.bringUp();
      m.tick({ pong: false });

      m.advance(3000);
      const commands = [...m.tick({ pong: false }), ...m.tick({ pong: false })];
      m.feed({ kind: 'pong' });
      commands.push(...m.run(5000));

      expect(commands).toEqual([]);
      expect(m.health.state).toBe('up');
    });

    it('fails at once when the sender reports MIDI lost', () => {
      const m = harness();
      m.bringUp();

      m.feed({ kind: 'fault', fault: 'midi-lost', detail: 'unplugged' });

      expect(m.health.state).toBe('down');
    });

    it('only logs when a send fails', () => {
      const m = harness();
      m.bringUp();

      const commands = m.feed({ kind: 'fault', fault: 'send-failed', detail: 'no output' });

      expect(names(commands)).toEqual(['log']);
      expect(m.health.state).toBe('up');
    });
  });

  describe('failing', () => {
    it('closes, puts the decks back on the mixer, logs the reason, then alerts, in that order', () => {
      const m = harness();
      m.bringUp();
      m.run(START_GRACE_MS);

      const commands = m.feed({ kind: 'fault', fault: 'midi-lost', detail: 'unplugged' });

      expect(names(commands)).toEqual(['close', 'route:mixer', 'log', 'alert:down']);
      expect(m.health.path).toBe('mixer');
    });

    it('leaves out the route when the decks were not on the sender', () => {
      const m = harness();
      m.grant();
      m.run(START_GRACE_MS);

      const commands = m.feed({ kind: 'break' });

      expect(names(commands)).toEqual(['close', 'log', 'alert:down']);
    });

    it('backs off 1, 2, 4, 8, 16, 30 and 30 seconds', () => {
      const m = harness();
      m.grant();

      const waits = RETRY_DELAYS_MS.map(() => failAndWaitForRetry(m));
      waits.push(failAndWaitForRetry(m));

      expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    });

    it('starts again at one second for an outage after the sender came back', () => {
      const m = harness();
      m.grant();
      failAndWaitForRetry(m);
      failAndWaitForRetry(m);
      m.frameComesUp();
      m.tick();
      m.feed({ kind: 'self-test', result: 'passed' });
      expect(m.health.state).toBe('up');

      expect(failAndWaitForRetry(m)).toBe(1000);
    });
  });

  describe('the alerts', () => {
    it('holds the down alert back during the grace period and raises it when the grace ends with the sender never up', () => {
      const m = harness();
      const startedAt = m.now();
      m.grant();
      const early: SenderCommand[] = [...m.feed({ kind: 'break' })];
      for (let retry = 0; retry < 3; retry++) {
        early.push(...untilOpen(m), ...m.feed({ kind: 'break' }));
      }
      expect(m.health.state).toBe('down');
      expect(m.now() - startedAt).toBeLessThan(START_GRACE_MS);
      expect(alerts(early)).toEqual([]);

      const untilGraceEnds: SenderCommand[] = [];
      while (m.now() - startedAt < START_GRACE_MS) {
        untilGraceEnds.push(...m.tick());
      }
      const afterwards = m.run(60_000);

      expect(alerts(untilGraceEnds)).toEqual(['alert:down']);
      expect(alerts(afterwards)).toEqual([]);
    });

    it('raises one back alert once the sender returns after a down alert', () => {
      const m = harness();
      m.grant();
      m.run(START_GRACE_MS);
      m.feed({ kind: 'break' });
      untilOpen(m);
      m.frameComesUp();
      m.tick();

      const commands = m.feed({ kind: 'self-test', result: 'passed' });

      expect(alerts(commands)).toEqual(['alert:back']);
      expect(alerts(m.run(10_000))).toEqual([]);
    });

    it('raises no back alert for a recovery nobody was told about', () => {
      const m = harness();
      m.grant();
      m.feed({ kind: 'break' });
      untilOpen(m);
      m.frameComesUp();
      m.tick();

      const commands = m.feed({ kind: 'self-test', result: 'passed' });

      expect(m.health.state).toBe('up');
      expect(alerts(commands)).toEqual([]);
    });
  });

  describe('the dev flip', () => {
    it('closes the sender and parks on the mixer, with no alert and no retry', () => {
      const m = harness();
      m.bringUp();

      const commands = m.feed({ kind: 'prefer', path: 'mixer' });
      const later = [...m.run(120_000), ...m.feed({ kind: 'fault', fault: 'midi-lost', detail: 'x' })];

      expect(names(commands)).toEqual(['close', 'route:mixer', 'log']);
      expect(m.health.state).toBe('parked');
      expect(m.health.path).toBe('mixer');
      expect(later).toEqual([]);
    });

    it('reopens the sender and takes it straight up, with no second own-thread test and no alert', () => {
      const m = harness();
      m.bringUp();
      m.feed({ kind: 'prefer', path: 'mixer' });

      const opened = m.feed({ kind: 'prefer', path: 'sender' });
      const ready = m.frameComesUp();

      expect(names(opened)).toEqual(['open', 'log']);
      expect(names(ready)).toEqual(['route:sender', 'log']);
      expect(m.health.state).toBe('up');
    });

    it('leaves a trace and changes nothing when the sender is not up', () => {
      const m = harness();
      m.grant();

      const commands = m.feed({ kind: 'prefer', path: 'mixer' });

      expect(names(commands)).toEqual(['log']);
      expect(m.health.state).toBe('opening');
    });
  });

  describe('the dev break', () => {
    it('takes the same failure path as a real failure from opening, testing and up', () => {
      const opening = harness();
      opening.grant();
      const testing = harness();
      testing.grant();
      testing.frameComesUp();
      const up = harness();
      up.bringUp();
      up.run(START_GRACE_MS);

      expect(names(opening.feed({ kind: 'break' }))).toEqual(['close', 'log']);
      expect(names(testing.feed({ kind: 'break' }))).toEqual(['close', 'log']);
      expect(names(up.feed({ kind: 'break' }))).toEqual(['close', 'route:mixer', 'log', 'alert:down']);
      expect([opening, testing, up].map((m) => m.health.state)).toEqual(['down', 'down', 'down']);
    });

    it('only logs where there is no frame to break', () => {
      const idle = harness();
      const down = harness();
      down.grant();
      down.feed({ kind: 'break' });
      const parked = harness();
      parked.bringUp();
      parked.feed({ kind: 'prefer', path: 'mixer' });
      const unavailable = harness();
      unavailable.feed({ kind: 'midi-granted', senderAddress: false });

      for (const m of [idle, down, parked, unavailable]) {
        const before = m.health.state;
        expect(names(m.feed({ kind: 'break' }))).toEqual(['log']);
        expect(m.health.state).toBe(before);
      }
    });
  });

  describe('cadence', () => {
    it('takes its tick from the protocol library, the number the infrastructure ticker beats', () => {
      expect(TICK_MS).toBe(SENDER_TICK_MS);
    });

    it('judges its deadlines in whole ticks, so rounding to the tick grid keeps noticing inside a second', () => {
      expect(HEALTH_TIMEOUT_MS % TICK_MS).toBe(0);
      expect(HELLO_TIMEOUT_MS % TICK_MS).toBe(0);
      expect(HEALTH_TIMEOUT_MS + TICK_MS).toBeLessThanOrEqual(1000);
      expect(HELLO_TIMEOUT_MS + TICK_MS).toBeLessThanOrEqual(1000);
    });

    it('calls a gap of more than one tick and less than two a stall, not a missed beat', () => {
      expect(STALL_GAP_MS).toBeGreaterThan(TICK_MS);
      expect(STALL_GAP_MS).toBeLessThan(TICK_MS * 2);
    });
  });
});
