/**
 * The cadence of the app page's steady ticker, in milliseconds. A worker on the app side beats it
 * (a worker's timers keep their pace while the page is hidden, a page's own do not), and the
 * application's health machine judges every deadline on those beats, as whole ticks. Both sides read
 * this one number, so changing it moves the deadlines and the stall threshold with it.
 */
export const SENDER_TICK_MS = 250;
