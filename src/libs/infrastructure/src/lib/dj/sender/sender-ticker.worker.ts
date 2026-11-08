import { SENDER_TICK_MS } from '@teensyrom-nx/asid-sender-protocol';

// The app page's steady ticker. A page's own timers slow to once a second, then once a minute, while
// it is hidden; a worker's do not, and the sender link's retries and deadlines run on these beats.
// The cadence is the protocol library's `SENDER_TICK_MS`, which the application's health machine
// reads too, so its deadlines and stall threshold follow it.
setInterval(() => postMessage(null), SENDER_TICK_MS);
