// The app page's steady ticker. A page's own timers slow to once a second, then once a minute, while
// it is hidden; a worker's do not, and the sender link's retries and deadlines run on these beats.
export const SENDER_TICK_INTERVAL_MS = 250;

setInterval(() => postMessage(null), SENDER_TICK_INTERVAL_MS);
