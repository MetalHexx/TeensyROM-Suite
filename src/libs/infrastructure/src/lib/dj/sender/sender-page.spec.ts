import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { SENDER_PAGE } from './sender-page';

describe('the browser sender page', () => {
  afterEach(() => {
    document.body.querySelectorAll('iframe').forEach((frame) => frame.remove());
  });

  describe('appendFrame', () => {
    function appendFrame(src = 'http://127.0.0.1:4200/asid-sender/index.html?v=1'): HTMLIFrameElement {
      return TestBed.inject(SENDER_PAGE).appendFrame(src);
    }

    it('puts the frame on the document body, pointed at the sender page', () => {
      const src = 'http://127.0.0.1:4200/asid-sender/index.html?v=1';

      const frame = appendFrame(src);

      expect(frame.parentElement).toBe(document.body);
      expect(frame.getAttribute('src')).toBe(src);
    });

    it('lets the frame use MIDI, which is what the browser needs to give the sender its own MIDI access', () => {
      const frame = appendFrame();

      expect(frame.getAttribute('allow')).toBe('midi');
    });

    it('gives it a real 1 px layout box that is transparent, since a frame with no box can be throttled', () => {
      const frame = appendFrame();

      expect(frame.style.display).not.toBe('none');
      expect(frame.style.visibility).not.toBe('hidden');
      expect(frame.style.position).toBe('fixed');
      expect(frame.style.width).toBe('1px');
      expect(frame.style.height).toBe('1px');
      expect(frame.style.opacity).toBe('0');
    });

    it('keeps it out of the way of the DJ: no pointer, no keyboard focus, hidden from assistive tech', () => {
      const frame = appendFrame();

      expect(frame.style.pointerEvents).toBe('none');
      expect(frame.tabIndex).toBe(-1);
      expect(frame.getAttribute('aria-hidden')).toBe('true');
    });
  });
});
