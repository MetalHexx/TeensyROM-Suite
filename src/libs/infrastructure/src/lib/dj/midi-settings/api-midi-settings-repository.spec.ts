import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  MidiSettingsApiService,
  type GetMidiSettingsResponse,
} from '@teensyrom-nx/data-access/api-client';
import type { MidiSettingsRecord } from '@teensyrom-nx/application';
import { ApiMidiSettingsRepository } from './api-midi-settings-repository';

const NO_SETTINGS: MidiSettingsRecord = {
  controllers: [],
  mappings: [],
  deckBindings: [],
  deckSettings: [],
  send: { lookaheadMs: 15, senderEnabled: true },
};

describe('ApiMidiSettingsRepository', () => {
  let repository: ApiMidiSettingsRepository;
  let api: {
    getMidiSettings: ReturnType<typeof vi.fn>;
    saveMidiSettings: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    api = {
      getMidiSettings: vi.fn(),
      saveMidiSettings: vi.fn().mockResolvedValue({ message: 'saved' }),
    };
    TestBed.configureTestingModule({
      providers: [ApiMidiSettingsRepository, { provide: MidiSettingsApiService, useValue: api }],
    });
    repository = TestBed.inject(ApiMidiSettingsRepository);
  });

  it('loads the set the server holds, mapped to records', async () => {
    const response: GetMidiSettingsResponse = {
      controllers: [{ id: 'launchpad', name: 'Launchpad', lastPortId: null, listening: true }],
      mappings: [],
      deckBindings: [{ slot: 'A', deviceId: '14470230', lastSeenName: 'TR-1' }],
      deckSettings: [{ slot: 'A', slip: true, liveLoopBeats: 0.5 }],
      sendSettings: { lookaheadMs: 20, senderEnabled: false },
    };
    api.getMidiSettings.mockResolvedValue(response);

    const settings = await repository.load();

    const { sendSettings, ...rest } = response;
    expect(settings).toEqual({ ...rest, send: sendSettings });
  });

  it('saves the whole set in the request body', async () => {
    const settings: MidiSettingsRecord = {
      controllers: [{ id: 'launchpad', name: 'Launchpad', lastPortId: 'p1', listening: false }],
      mappings: [],
      deckBindings: [{ slot: 'B', deviceId: '19277260', lastSeenName: 'TR-2' }],
      deckSettings: [{ slot: 'B', slip: false, liveLoopBeats: 4 }],
      send: { lookaheadMs: 20, senderEnabled: false },
    };

    await repository.save(settings);

    const { send, ...rest } = settings;
    expect(api.saveMidiSettings).toHaveBeenCalledWith(
      { saveMidiSettingsRequest: { ...rest, sendSettings: send } },
      undefined
    );
  });

  it('passes keepalive to the client as a request override', async () => {
    await repository.save(NO_SETTINGS, { keepalive: true });

    expect(api.saveMidiSettings).toHaveBeenCalledWith(
      {
        saveMidiSettingsRequest: {
          controllers: [],
          mappings: [],
          deckBindings: [],
          deckSettings: [],
          sendSettings: NO_SETTINGS.send,
        },
      },
      { keepalive: true }
    );
  });

  it('lets a failed load propagate', async () => {
    api.getMidiSettings.mockRejectedValue(new Error('500'));

    await expect(repository.load()).rejects.toThrow('500');
  });

  it('lets a failed save propagate', async () => {
    api.saveMidiSettings.mockRejectedValue(new Error('400'));

    await expect(
      repository.save(NO_SETTINGS)
    ).rejects.toThrow('400');
  });
});
