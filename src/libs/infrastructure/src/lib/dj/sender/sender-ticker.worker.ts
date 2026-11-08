// The app page's steady ticker. A page's own timers slow to once a second, then once a minute, while
// it is hidden; a worker's do not, and the sender link's retries and deadlines run on these beats.
// This file owns the cadence; the application's `TICK_MS` and `STALL_GAP_MS` assume it.
const SENDER_TICK_INTERVAL_MS = 250;

setInterval(() => postMessage(null), SENDER_TICK_INTERVAL_MS);
