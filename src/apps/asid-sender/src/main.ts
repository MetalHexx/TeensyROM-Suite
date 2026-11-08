import { ConnectGuard } from './connect-guard';
import type { MidiOutputLike } from './midi-outputs';
import { Session } from './session';
import type { AlarmClock, AlarmReply, AlarmRequest } from './waiter';

const guard = new ConnectGuard(window);

window.addEventListener('message', (event: MessageEvent) => {
  const port = guard.accept(event);
  if (port) {
    connect(port);
  }
});

/** Kept so the browser does not collect a status while it is being listened to. */
const watchedPermissions: PermissionStatus[] = [];

function watchMidiPermission(listener: (state: string) => void): void {
  navigator.permissions
    ?.query({ name: 'midi', sysex: true } as PermissionDescriptor)
    .then((status) => {
      watchedPermissions.push(status);
      status.onchange = () => listener(status.state);
    })
    .catch((error: unknown) => console.warn('MIDI permission status unavailable', error));
}

function connect(port: MessagePort): void {
  const worker = new Worker(new URL('./alarm.worker.ts', import.meta.url), { type: 'module' });
  const askWorker = (request: AlarmRequest) => worker.postMessage(request);
  const alarm: AlarmClock = {
    arm: (id, delayMs) => askWorker({ alarm: id, delayMs }),
    disarm: () => askWorker({ alarm: null, delayMs: 0 }),
    probe: (seq, delayMs) => askWorker({ probe: seq, delayMs }),
  };
  const turns = new MessageChannel();
  const ticks = new MessageChannel();

  const session = new Session({
    port,
    now: () => performance.now(),
    timeOrigin: performance.timeOrigin,
    random: () => Math.random(),
    alarm,
    postTurn: () => turns.port1.postMessage(0),
    postTick: () => ticks.port1.postMessage(0),
    requestMidiAccess: async () => {
      const access = await navigator.requestMIDIAccess({ sysex: true });
      return {
        outputs: () => {
          const all: MidiOutputLike[] = [];
          access.outputs.forEach((output) =>
            all.push({
              name: output.name,
              state: output.state,
              // This TypeScript's DOM typings take `number[]`; the Web MIDI spec takes any octets.
              send: (data) => output.send(Array.from(data)),
            })
          );
          return all;
        },
        onChange: (listener) => {
          access.onstatechange = () => listener();
        },
      };
    },
    watchMidiPermission,
    visibility: () => (document.visibilityState === 'hidden' ? 'hidden' : 'visible'),
  });

  turns.port2.onmessage = () => session.onTurn();
  ticks.port2.onmessage = () => session.onTick();
  worker.onmessage = ({ data }: MessageEvent<AlarmReply>) => {
    if ('alarm' in data) {
      session.onAlarm(data.alarm);
    } else {
      session.onProbe(data.probe);
    }
  };
  document.addEventListener('visibilitychange', () =>
    session.onVisibility(document.visibilityState === 'hidden' ? 'hidden' : 'visible')
  );
  port.onmessage = (event) => session.onMessage(event.data);

  void session.start();
}
