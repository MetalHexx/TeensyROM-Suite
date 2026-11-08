// The alarm clock. A hidden page's own timers slow to about once a second; a worker's do not.
import type { AlarmReply, AlarmRequest } from './waiter';

interface AlarmScope {
  onmessage: ((event: MessageEvent<AlarmRequest>) => void) | null;
  postMessage(message: AlarmReply): void;
}

const scope = self as unknown as AlarmScope;
let handle: ReturnType<typeof setTimeout> | undefined;

scope.onmessage = ({ data }) => {
  if ('probe' in data) {
    // A probe only times a wait; there is nothing to cancel.
    const { probe } = data;
    setTimeout(() => scope.postMessage({ probe }), data.delayMs);
    return;
  }
  clearTimeout(handle);
  if (data.alarm !== null) {
    const { alarm } = data;
    handle = setTimeout(() => scope.postMessage({ alarm }), data.delayMs);
  }
};
