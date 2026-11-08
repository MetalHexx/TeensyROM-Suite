import { ASID_SENDER_IDENTITY } from '@teensyrom-nx/asid-sender-protocol';
import { ConnectGuard, type ConnectEvent } from './connect-guard';

const parent = { name: 'the app window' };
const port = { name: 'the channel port' };

const senderAt = (hostname: string, protocol = 'http:', portNumber = '4200') => ({
  parent,
  location: { protocol, hostname, port: portNumber },
});

function connectFrom(changes: Partial<ConnectEvent<unknown>> = {}): ConnectEvent<unknown> {
  return {
    source: parent,
    origin: 'http://localhost:4200',
    data: { k: 'connect', identity: ASID_SENDER_IDENTITY, version: 1 },
    ports: [port],
    ...changes,
  };
}

describe('ConnectGuard', () => {
  it("accepts a connect from its parent, on the app's other local name, and hands back the port", () => {
    const guard = new ConnectGuard(senderAt('127.0.0.1'));
    expect(guard.accept(connectFrom())).toBe(port);
  });

  it('works the other way round, and over https', () => {
    const guard = new ConnectGuard(senderAt('localhost', 'https:', '10213'));
    expect(guard.accept(connectFrom({ origin: 'https://127.0.0.1:10213' }))).toBe(port);
  });

  it('does not mind which protocol version the app asks for', () => {
    const guard = new ConnectGuard(senderAt('127.0.0.1'));
    const data = { k: 'connect', identity: ASID_SENDER_IDENTITY, version: 99 };
    expect(guard.accept(connectFrom({ data }))).toBe(port);
  });

  it.each([
    ['its own origin', { origin: 'http://127.0.0.1:4200' }],
    ['another host', { origin: 'http://example.com:4200' }],
    ['another port', { origin: 'http://localhost:4201' }],
    ['another scheme', { origin: 'https://localhost:4200' }],
    ['an opaque origin', { origin: 'null' }],
    ['a source that is not its parent', { source: { name: 'some other window' } }],
    ['no source', { source: null }],
    ['no port', { ports: [] }],
    ['the wrong identity', { data: { k: 'connect', identity: 'someone-else', version: 1 } }],
    ['no identity', { data: { k: 'connect', version: 1 } }],
    ['some other message', { data: { k: 'ping', seq: 1 } }],
    ['a string', { data: 'connect' }],
    ['nothing', { data: undefined }],
  ])('ignores a connect with %s', (_what, changes) => {
    const guard = new ConnectGuard(senderAt('127.0.0.1'));
    expect(guard.accept(connectFrom(changes))).toBeNull();
  });

  it('never accepts when its own host has no other local name', () => {
    const guard = new ConnectGuard(senderAt('example.com'));
    expect(guard.accept(connectFrom({ origin: 'http://example.com:4200' }))).toBeNull();
    expect(guard.accept(connectFrom({ origin: 'null' }))).toBeNull();
    expect(guard.accept(connectFrom())).toBeNull();
  });

  it('keeps listening after a message it ignored', () => {
    const guard = new ConnectGuard(senderAt('127.0.0.1'));
    expect(guard.accept(connectFrom({ origin: 'http://evil.example' }))).toBeNull();
    expect(guard.accept(connectFrom())).toBe(port);
  });

  it('accepts only one connect in a page load', () => {
    const guard = new ConnectGuard(senderAt('127.0.0.1'));
    expect(guard.accept(connectFrom())).toBe(port);
    expect(guard.accept(connectFrom({ ports: [{ name: 'another port' }] }))).toBeNull();
    expect(guard.accept(connectFrom())).toBeNull();
  });
});
