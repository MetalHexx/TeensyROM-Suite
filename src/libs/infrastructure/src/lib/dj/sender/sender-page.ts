import { InjectionToken } from '@angular/core';

/** The browser surfaces the sender link builds its frame, channel, ticker and clock through. */
export interface SenderPage {
  /** Appends the hidden, 1px, non-interactive sender frame to `document.body`. */
  appendFrame(src: string): HTMLIFrameElement;
  createChannel(): MessageChannel;
  /** Starts the steady ticker; `onTick` runs on every beat, whether or not the page is hidden. */
  startTicker(onTick: () => void): void;
  /** This page's `performance.now()`. */
  now(): number;
  /** This page's `performance.timeOrigin`. */
  timeOrigin(): number;
  location(): { protocol: string; hostname: string; port: string };
}

const FRAME_STYLE =
  'position:fixed;left:0;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';

/** Never `display:none`: a frame without a layout box can have its work throttled. */
function appendHiddenFrame(src: string): HTMLIFrameElement {
  const frame = document.createElement('iframe');
  frame.src = src;
  frame.setAttribute('allow', 'midi');
  frame.tabIndex = -1;
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = FRAME_STYLE;
  document.body.appendChild(frame);
  return frame;
}

function startWorkerTicker(onTick: () => void): void {
  const worker = new Worker(new URL('./sender-ticker.worker', import.meta.url), {
    type: 'module',
  });
  worker.onmessage = onTick;
}

const browserSenderPage: SenderPage = {
  appendFrame: appendHiddenFrame,
  createChannel: () => new MessageChannel(),
  startTicker: startWorkerTicker,
  now: () => performance.now(),
  timeOrigin: () => performance.timeOrigin,
  location: () => window.location,
};

/** Internal: the spec overrides it; nothing else does. */
export const SENDER_PAGE = new InjectionToken<SenderPage>('SENDER_PAGE', {
  providedIn: 'root',
  factory: () => browserSenderPage,
});
