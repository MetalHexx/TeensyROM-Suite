import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { milliseconds } from '@sidablist/core';
import { ASID_SENDER_LINK } from '../ports';
import { FakeSenderLink } from '../testing/deck-runtime-fakes';
import {
  DeckSendRoute,
  MIXER_SCHEDULE_AHEAD_MS,
  SENDER_SCHEDULE_AHEAD_MS,
} from './deck-send-route';

describe('DeckSendRoute', () => {
  describe('with a link', () => {
    let route: DeckSendRoute;
    let link: FakeSenderLink;

    beforeEach(() => {
      link = new FakeSenderLink();
      TestBed.configureTestingModule({ providers: [{ provide: ASID_SENDER_LINK, useValue: link }] });
      route = TestBed.inject(DeckSendRoute);
    });

    it('starts on the mixer', () => {
      expect(route.path()).toBe('mixer');
    });

    it('follows the path it is set to', () => {
      route.setPath('sender');
      expect(route.path()).toBe('sender');

      route.setPath('mixer');
      expect(route.path()).toBe('mixer');
    });

    it('keeps a lookahead for each path, the sender at 15 ms and the mixer at none', () => {
      expect(route.lookaheadFor('mixer')).toBe(MIXER_SCHEDULE_AHEAD_MS);
      expect(route.lookaheadFor('sender')).toBe(SENDER_SCHEDULE_AHEAD_MS);
      expect([MIXER_SCHEDULE_AHEAD_MS, SENDER_SCHEDULE_AHEAD_MS]).toEqual([0, 15]);
    });

    it('changes one path\'s lookahead without touching the other', () => {
      route.setLookahead('sender', milliseconds(20));

      expect(route.lookaheadFor('sender')).toBe(20);
      expect(route.lookaheadFor('mixer')).toBe(0);
    });

    it('lists the cartridges the sender lists, and hands back the list it replaced', () => {
      expect(route.isListedBySender('1234')).toBe(false);

      const first = route.setSenderTokens(['1234']);
      const second = route.setSenderTokens(['5678']);

      expect([...first]).toEqual([]);
      expect([...second]).toEqual(['1234']);
      expect(route.isListedBySender('1234')).toBe(false);
      expect(route.isListedBySender('5678')).toBe(true);
    });

    it('hands a packet to the link with its token and due time', () => {
      const bytes = new Uint8Array([1, 2, 3]);

      route.sendToSender('1234', bytes, 42);

      expect(link.sends).toEqual([{ token: '1234', bytes, dueAtMs: 42 }]);
    });
  });

  describe('with no link', () => {
    let route: DeckSendRoute;

    beforeEach(() => {
      route = TestBed.inject(DeckSendRoute);
    });

    it('stays on the mixer however it is asked', () => {
      route.setPath('sender');

      expect(route.path()).toBe('mixer');
    });

    it('sends nothing and does not throw', () => {
      expect(() => route.sendToSender('1234', new Uint8Array(1))).not.toThrow();
    });
  });
});
