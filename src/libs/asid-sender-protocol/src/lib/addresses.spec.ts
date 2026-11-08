import {
  ASID_SENDER_PATH,
  isAsidSenderPath,
  otherLocalName,
  pairedLocalOrigin,
  startUnlessSenderPath,
} from './addresses';

describe('otherLocalName', () => {
  it('swaps the two local names', () => {
    expect(otherLocalName('localhost')).toBe('127.0.0.1');
    expect(otherLocalName('127.0.0.1')).toBe('localhost');
  });

  it.each(['example.com', '192.168.1.5', '[::1]', '', 'localhost.localdomain'])(
    'has none for %j',
    (host) => {
      expect(otherLocalName(host)).toBeNull();
    }
  );
});

describe('pairedLocalOrigin', () => {
  it.each([
    ['http:', 'localhost', '4200', 'http://127.0.0.1:4200'],
    ['http:', '127.0.0.1', '4200', 'http://localhost:4200'],
    ['https:', 'localhost', '10213', 'https://127.0.0.1:10213'],
    ['https:', '127.0.0.1', '10213', 'https://localhost:10213'],
    ['http:', 'localhost', '', 'http://127.0.0.1'],
    ['https:', '127.0.0.1', '', 'https://localhost'],
  ])('%s //%s port %j gives %s', (protocol, hostname, port, expected) => {
    expect(pairedLocalOrigin({ protocol, hostname, port })).toBe(expected);
  });

  it('is symmetric', () => {
    const there = pairedLocalOrigin({ protocol: 'http:', hostname: 'localhost', port: '4200' });
    const url = new URL(there as string);
    expect(pairedLocalOrigin(url)).toBe('http://localhost:4200');
  });

  it('is null for any other host', () => {
    expect(pairedLocalOrigin({ protocol: 'https:', hostname: 'example.com', port: '' })).toBeNull();
    expect(
      pairedLocalOrigin({ protocol: 'http:', hostname: '192.168.1.5', port: '80' })
    ).toBeNull();
  });
});

describe('isAsidSenderPath', () => {
  it.each(['/asid-sender', '/asid-sender/', '/asid-sender/index.html', '/asid-sender/assets/a.js'])(
    'is true for %s',
    (path) => {
      expect(isAsidSenderPath(path)).toBe(true);
    }
  );

  it.each([
    '/',
    '/index.html',
    '/asid-senders',
    '/asid-sender-x/a',
    '/dj/asid-sender',
    '/ASID-SENDER',
  ])('is false for %s', (path) => {
    expect(isAsidSenderPath(path)).toBe(false);
  });

  it('covers the path both servers serve the sender at', () => {
    expect(isAsidSenderPath(ASID_SENDER_PATH)).toBe(true);
  });
});

describe('startUnlessSenderPath', () => {
  it('never starts for a sender path', () => {
    const start = vi.fn();
    startUnlessSenderPath('/asid-sender/index.html', start);
    startUnlessSenderPath('/asid-sender', start);
    expect(start).not.toHaveBeenCalled();
  });

  it('starts once for any other path', () => {
    const start = vi.fn();
    startUnlessSenderPath('/dj', start);
    expect(start).toHaveBeenCalledTimes(1);
  });
});
