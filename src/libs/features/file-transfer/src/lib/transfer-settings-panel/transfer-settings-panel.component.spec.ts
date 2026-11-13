import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of, switchMap, throwError, timer } from 'rxjs';
import { vi } from 'vitest';
import { DeviceStore, SettingsStore } from '@teensyrom-nx/application';
import {
  Device,
  FileTransferSettings,
  ISettingsService,
  PlayerFilterType,
  SETTINGS_SERVICE,
  Settings,
  StorageType,
  WATCH_FOLDER_SERVICE,
  WatchFolder,
  WatchFolderField,
  WatchFolderRejectedError,
  WatchFolderState,
} from '@teensyrom-nx/domain';
import { TransferSettingsPanelComponent } from './transfer-settings-panel.component';

const folder = (id: string, overrides: Partial<WatchFolder> = {}): WatchFolder => ({
  id,
  path: `C:\\Watch\\${id}`,
  enabled: true,
  state: WatchFolderState.Watching,
  allFileTypes: false,
  allFileTypesInArchives: false,
  destinations: [
    {
      id: `${id}-1`,
      deviceId: 'dev-1',
      deviceName: 'Rack TeensyROM',
      storageType: StorageType.Sd,
      path: '/auto-transfer',
      launch: true,
    },
  ],
  ...overrides,
});

const device = (deviceId: string, name: string, usb: boolean): Device =>
  ({
    deviceId,
    name,
    sdStorage: { available: true },
    usbStorage: { available: usb },
  }) as unknown as Device;

const rackDevice = device('dev-1', 'Rack TeensyROM', false);
const benchDevice = device('dev-2', 'Bench TeensyROM', true);

const uploadSettings = (overrides: Partial<FileTransferSettings> = {}): FileTransferSettings => ({
  autoLaunchOnCopyEnabled: false,
  allFileTypesInFolders: false,
  allFileTypesInArchives: false,
  ...overrides,
});

const settings = (): Settings =>
  ({
    playerSettings: {
      repeatModeOnStartup: false,
      playTimerEnabled: false,
      muteFastForward: false,
      muteRandomSeek: false,
      startupFilter: PlayerFilterType.All,
      startupLaunchEnabled: false,
      startupLaunchRandom: false,
    },
    fileTransferSettings: uploadSettings(),
    searchSettings: {
      weights: {
        nameWeight: 1,
        titleWeight: 1,
        creatorWeight: 1,
        releaseInfoWeight: 1,
        descriptionWeight: 1,
      },
      stopWords: [],
      bannedDirectories: [],
      bannedFiles: [],
    },
    appSettings: { setupCompleted: true },
    knownDevices: [],
  }) as unknown as Settings;

describe('TransferSettingsPanelComponent', () => {
  let fixture: ComponentFixture<TransferSettingsPanelComponent>;
  let settingsService: {
    getSettings: ReturnType<typeof vi.fn>;
    saveSettings: ReturnType<typeof vi.fn>;
    getFileTransferSettings: ReturnType<typeof vi.fn>;
    saveFileTransferSettings: ReturnType<typeof vi.fn>;
  };
  /** What the engine holds for the three Uploads switches. */
  let engineUploads: FileTransferSettings;
  let watchFolders: Record<string, ReturnType<typeof vi.fn>>;
  let settingsStore: InstanceType<typeof SettingsStore>;
  let initialFolders: WatchFolder[];

  const native = () => fixture.nativeElement as HTMLElement;
  const query = <T extends HTMLElement>(testId: string) =>
    native().querySelector<T>(`[data-testid="${testId}"]`);
  const queryAll = (testId: string) =>
    Array.from(native().querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`));
  const clickButton = (host: HTMLElement | null | undefined) =>
    host?.querySelector('button')?.click();
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const added = (watchFolder: WatchFolder, created = true) => ({ watchFolder, created });

  const setup = async (options: { folders?: WatchFolder[]; withSettings?: boolean } = {}) => {
    initialFolders = options.folders ?? [];
    engineUploads = uploadSettings();
    settingsService = {
      getSettings: vi.fn().mockReturnValue(of(settings())),
      saveSettings: vi.fn().mockReturnValue(of(undefined)),
      getFileTransferSettings: vi.fn().mockImplementation(() => of({ ...engineUploads })),
      saveFileTransferSettings: vi
        .fn()
        .mockImplementation((change: Partial<FileTransferSettings>) => {
          engineUploads = { ...engineUploads, ...change };
          return of({ ...engineUploads });
        }),
    };
    watchFolders = {
      list: vi.fn().mockImplementation(async () => initialFolders),
      add: vi.fn(),
      setDestination: vi.fn(),
      setEnabled: vi.fn(),
      setFileTypes: vi.fn(),
      remove: vi.fn().mockResolvedValue(undefined),
      removeDestination: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [TransferSettingsPanelComponent],
      providers: [
        provideNoopAnimations(),
        { provide: SETTINGS_SERVICE, useValue: settingsService as unknown as ISettingsService },
        { provide: WATCH_FOLDER_SERVICE, useValue: watchFolders },
        { provide: DeviceStore, useValue: { usableDevices: signal([rackDevice, benchDevice]) } },
      ],
    }).compileComponents();

    settingsStore = TestBed.inject(SettingsStore);
    if (options.withSettings !== false) {
      await settingsStore.loadSettings();
    }

    fixture = TestBed.createComponent(TransferSettingsPanelComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await settle();
  };

  afterEach(() => fixture?.destroy());

  describe('uploads', () => {
    const switches = [
      { testId: 'auto-launch-switch', key: 'autoLaunchOnCopyEnabled' },
      { testId: 'all-types-in-folders-switch', key: 'allFileTypesInFolders' },
      { testId: 'all-types-in-archives-switch', key: 'allFileTypesInArchives' },
    ] as const;
    const isOn = (testId: string) =>
      query(testId)?.querySelector('button')?.getAttribute('aria-checked');

    it('reflects each stored setting', async () => {
      await setup();
      expect(switches.map(({ testId }) => isOn(testId))).toEqual(['false', 'false', 'false']);

      settingsStore.updateSettings({
        settings: { fileTransferSettings: uploadSettings({ allFileTypesInFolders: true }) },
      });
      await settle();

      expect(switches.map(({ testId }) => isOn(testId))).toEqual(['false', 'true', 'false']);
    });

    for (const { testId, key } of switches) {
      it(`saves only its own setting when ${key} is toggled`, async () => {
        await setup();

        clickButton(query(testId));
        await settle();

        expect(settingsService.saveFileTransferSettings).toHaveBeenCalledTimes(1);
        expect(settingsService.saveFileTransferSettings).toHaveBeenCalledWith({ [key]: true });
        expect(settingsService.saveSettings).not.toHaveBeenCalled();
        expect(settingsStore.getSettings()()?.fileTransferSettings[key]).toBe(true);
        expect(isOn(testId)).toBe('true');
      });
    }

    it('shows the failure and keeps the switch at the saved value when the save fails', async () => {
      await setup();
      settingsService.saveFileTransferSettings.mockImplementation(() =>
        timer(0).pipe(switchMap(() => throwError(() => new Error('Engine offline'))))
      );

      clickButton(query('all-types-in-folders-switch'));
      await settle();
      await settle();

      expect(query('settings-error')?.textContent).toContain('Engine offline');
      expect(settingsStore.getSettings()()?.fileTransferSettings.allFileTypesInFolders).toBe(false);
      expect(isOn('all-types-in-folders-switch')).toBe('false');
    });

    it('re-reads the engine settings each time the panel opens', async () => {
      await setup();
      expect(settingsService.getFileTransferSettings).toHaveBeenCalledTimes(1);

      fixture.componentRef.setInput('open', false);
      fixture.detectChanges();
      engineUploads = uploadSettings({ allFileTypesInArchives: true });
      fixture.componentRef.setInput('open', true);
      fixture.detectChanges();
      await settle();
      await settle();

      expect(settingsService.getFileTransferSettings).toHaveBeenCalledTimes(2);
      expect(isOn('all-types-in-archives-switch')).toBe('true');
    });

    it('is disabled while settings have not loaded', async () => {
      await setup({ withSettings: false });

      for (const { testId } of switches) {
        expect(query(testId)?.querySelector('button')?.disabled).toBe(true);
      }
    });
  });

  describe('watch folder list', () => {
    it('loads the list each time the panel opens', async () => {
      await setup({ folders: [folder('a')] });
      expect(watchFolders['list']).toHaveBeenCalledTimes(1);

      fixture.componentRef.setInput('open', false);
      fixture.detectChanges();
      initialFolders = [folder('a'), folder('b')];
      fixture.componentRef.setInput('open', true);
      fixture.detectChanges();
      await settle();

      expect(watchFolders['list']).toHaveBeenCalledTimes(2);
      expect(queryAll('watch-folder')).toHaveLength(2);
    });

    it('shows the empty state when there are no folders', async () => {
      await setup();

      expect(query('watch-folders-empty')?.textContent).toContain('No watch folders yet');
    });

    it('shows each folder with its path, switch and device rows', async () => {
      await setup({ folders: [folder('a'), folder('b')] });

      expect(queryAll('watch-folder')).toHaveLength(2);
      const path = query('watch-folder-path');
      expect(path?.getAttribute('title')).toBe('C:\\Watch\\a');
      expect(path?.textContent).toContain('C:\\Watch\\a');
      expect(queryAll('watch-folder-device-name')[0].textContent).toBe('Rack TeensyROM');
      expect(queryAll('watch-folder-device-target')[0].textContent).toContain('SD /auto-transfer');
      expect(queryAll('watch-folder-device-launch')).toHaveLength(2);
    });

    it('falls back to the device id and omits the Launch tag when launch is off', async () => {
      const f = folder('a');
      f.destinations[0] = { ...f.destinations[0], deviceName: null, launch: false };
      await setup({ folders: [f] });

      expect(query('watch-folder-device-name')?.textContent).toBe('dev-1');
      expect(query('watch-folder-device-launch')).toBeNull();
    });

    it('dims an off folder and leaves a watching folder undimmed', async () => {
      await setup({
        folders: [folder('a'), folder('b', { enabled: false, state: WatchFolderState.Off })],
      });

      const [watching, off] = queryAll('watch-folder');
      expect(watching.classList.contains('folder-block--off')).toBe(false);
      expect(off.classList.contains('folder-block--off')).toBe(true);
    });

    it('notes an unavailable folder', async () => {
      await setup({
        folders: [folder('a', { state: WatchFolderState.Unavailable }), folder('b')],
      });

      const notes = queryAll('watch-folder-unavailable');
      expect(notes).toHaveLength(1);
      expect(notes[0].textContent).toContain('Unavailable');
    });

    it('shows a list-level error', async () => {
      await setup();
      watchFolders['list'].mockRejectedValue(new Error('engine down'));

      fixture.componentRef.setInput('open', false);
      fixture.detectChanges();
      fixture.componentRef.setInput('open', true);
      fixture.detectChanges();
      await settle();

      expect(query('watch-folders-error')?.textContent).toContain('engine down');
    });

    it('gives every icon-only button an accessible name', async () => {
      await setup({ folders: [folder('a')] });

      const buttons = Array.from(native().querySelectorAll('button')).filter(
        (b) => !b.closest('mat-slide-toggle')
      );
      expect(buttons.length).toBeGreaterThan(0);
      buttons.forEach((button) => {
        const name = button.getAttribute('aria-label') ?? button.textContent?.trim();
        expect(name).toBeTruthy();
      });
    });
  });

  describe('changes', () => {
    it('switches a folder off through the store and updates its row', async () => {
      await setup({ folders: [folder('a')] });
      watchFolders['setEnabled'].mockResolvedValue(
        folder('a', { enabled: false, state: WatchFolderState.Off })
      );

      query('watch-folder-switch')?.querySelector('button')?.click();
      await settle();

      expect(watchFolders['setEnabled']).toHaveBeenCalledWith('a', false);
      expect(query('watch-folder')?.classList.contains('folder-block--off')).toBe(true);
    });

    it('keeps the switch where it was when the engine refuses the change', async () => {
      await setup({ folders: [folder('a')] });
      watchFolders['setEnabled'].mockRejectedValue(new Error('Watch folder not found'));

      query('watch-folder-switch')?.querySelector('button')?.click();
      await settle();

      expect(query('watch-folders-error')?.textContent).toContain('Watch folder not found');
      expect(
        query('watch-folder-switch')?.querySelector('button')?.getAttribute('aria-checked')
      ).toBe('true');
    });

    it('names each folder file-type switch for its folder and shows the saved values', async () => {
      await setup({ folders: [folder('a', { allFileTypesInArchives: true }), folder('b')] });

      const buttons = (testId: string) =>
        queryAll(testId).map((host) => host.querySelector('button'));
      expect(buttons('watch-folder-all-types-switch').map((b) => b?.getAttribute('aria-label'))).toEqual([
        'All file types for C:\\Watch\\a',
        'All file types for C:\\Watch\\b',
      ]);
      expect(
        buttons('watch-folder-all-in-archives-switch').map((b) => b?.getAttribute('aria-label'))
      ).toEqual([
        'All file types in archives for C:\\Watch\\a',
        'All file types in archives for C:\\Watch\\b',
      ]);
      expect(
        buttons('watch-folder-all-in-archives-switch').map((b) => b?.getAttribute('aria-checked'))
      ).toEqual(['true', 'false']);
    });

    it('saves a flipped file-type switch through the store and redraws from the answer', async () => {
      await setup({ folders: [folder('a')] });
      watchFolders['setFileTypes'].mockResolvedValue(folder('a', { allFileTypes: true }));

      clickButton(query('watch-folder-all-types-switch'));
      await settle();

      expect(watchFolders['setFileTypes']).toHaveBeenCalledWith('a', { allFileTypes: true });
      expect(
        query('watch-folder-all-types-switch')?.querySelector('button')?.getAttribute('aria-checked')
      ).toBe('true');
    });

    it('keeps a file-type switch where it was and shows the error when the save fails', async () => {
      await setup({ folders: [folder('a')] });
      watchFolders['setFileTypes'].mockRejectedValue(new Error('Watch folder not found'));

      clickButton(query('watch-folder-all-in-archives-switch'));
      await settle();

      expect(query('watch-folders-error')?.textContent).toContain('Watch folder not found');
      expect(
        query('watch-folder-all-in-archives-switch')
          ?.querySelector('button')
          ?.getAttribute('aria-checked')
      ).toBe('false');
    });

    it('asks before removing a folder, then removes it', async () => {
      await setup({ folders: [folder('a')] });

      clickButton(query('watch-folder-delete'));
      await settle();
      expect(watchFolders['remove']).not.toHaveBeenCalled();

      const dialog = document.querySelector('lib-confirmation-dialog');
      expect(dialog?.textContent).toContain('Stop watching this folder?');
      const confirm = Array.from(dialog?.querySelectorAll('button') ?? []).find((b) =>
        b.textContent?.includes('Stop watching')
      );
      confirm?.click();
      await settle();

      expect(watchFolders['remove']).toHaveBeenCalledWith('a');
      expect(queryAll('watch-folder')).toHaveLength(0);
    });

    it('does not remove a folder when the confirmation is cancelled', async () => {
      await setup({ folders: [folder('a')] });

      clickButton(query('watch-folder-delete'));
      await settle();
      const cancel = Array.from(
        document.querySelectorAll('lib-confirmation-dialog button')
      ).find((b) => b.textContent?.includes('Cancel')) as HTMLButtonElement | undefined;
      cancel?.click();
      await settle();

      expect(watchFolders['remove']).not.toHaveBeenCalled();
      expect(queryAll('watch-folder')).toHaveLength(1);
    });

    it('warns that removing the last device removes the folder, and drops the folder', async () => {
      await setup({ folders: [folder('a')] });
      watchFolders['removeDestination'].mockResolvedValue({ folderRemoved: true, watchFolder: null });

      clickButton(query('watch-folder-device-delete'));
      await settle();
      const dialog = document.querySelector('lib-confirmation-dialog');
      expect(dialog?.textContent).toContain('Remove this device?');
      expect(dialog?.textContent).toContain('so the folder is removed too');
      (Array.from(dialog?.querySelectorAll('button') ?? []).find((b) =>
        b.textContent?.includes('Remove')
      ) as HTMLButtonElement).click();
      await settle();

      expect(watchFolders['removeDestination']).toHaveBeenCalledWith('a', 'dev-1');
      expect(queryAll('watch-folder')).toHaveLength(0);
    });

    it('does not warn about the folder when other devices remain', async () => {
      const f = folder('a');
      f.destinations.push({ ...f.destinations[0], id: 'a-2', deviceId: 'dev-2' });
      await setup({ folders: [f] });

      clickButton(queryAll('watch-folder-device-delete')[0]);
      await settle();

      expect(document.querySelector('lib-confirmation-dialog')?.textContent).not.toContain(
        'so the folder is removed too'
      );
    });
  });

  describe('forms', () => {
    const type = async (testId: string, value: string) => {
      const input = query<HTMLInputElement>(testId);
      if (!input) throw new Error(`No field ${testId}`);
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await settle();
    };
    const optionLabels = () =>
      Array.from(document.querySelectorAll('mat-option')).map((o) => o.textContent?.trim());
    const openSelect = async (testId: string) => {
      query(testId)?.querySelector<HTMLElement>('.mat-mdc-select-trigger')?.click();
      await settle();
    };
    const choose = async (testId: string, label: string) => {
      await openSelect(testId);
      Array.from(document.querySelectorAll<HTMLElement>('mat-option'))
        .find((o) => o.textContent?.trim() === label)
        ?.click();
      await settle();
    };
    const selectedDevice = () =>
      query('form-device')?.querySelector('.mat-mdc-select-value')?.textContent?.trim();
    const storageToggle = (label: string) =>
      Array.from(query('form-storage')?.querySelectorAll<HTMLElement>('mat-button-toggle') ?? []).find(
        (toggle) => toggle.textContent?.trim() === label
      );
    const storageDisabled = (label: string) =>
      storageToggle(label)?.classList.contains('mat-button-toggle-disabled');
    const selectedStorage = () =>
      query('form-storage')?.querySelector('.mat-button-toggle-checked')?.textContent?.trim();
    const chooseStorage = async (label: string) => {
      storageToggle(label)?.querySelector('button')?.click();
      await settle();
    };
    const submitButton = () => query('form-submit')?.querySelector('button');
    const submit = async () => {
      submitButton()?.click();
      await settle();
      await settle();
    };
    const errorText = (testId: string) => query(testId)?.textContent?.trim();
    const reject = (field: WatchFolderField | null, message: string) =>
      new WatchFolderRejectedError(400, message, field);

    const fillAddFolder = async () => {
      clickButton(query('add-watch-folder'));
      await settle();
      await type('form-folder', '  D:\\Incoming  ');
      await choose('form-device', 'Bench TeensyROM');
    };

    describe('add folder', () => {
      it('starts on the first connected device with its SD storage, /auto-transfer and launch off', async () => {
        await setup();
        clickButton(query('add-watch-folder'));
        await settle();
        await settle();

        expect(selectedDevice()).toBe('Rack TeensyROM');
        expect(selectedStorage()).toBe('SD');
        expect(query<HTMLInputElement>('form-device-path')?.value).toBe('/auto-transfer');
        expect(query('form-launch')?.querySelector('button')?.getAttribute('aria-checked')).toBe('false');
      });

      it('starts with both file-type switches off and sends them as chosen', async () => {
        await setup();
        watchFolders['add'].mockResolvedValue(added(folder('new', { allFileTypes: true })));
        await fillAddFolder();
        const checked = (testId: string) =>
          query(testId)?.querySelector('button')?.getAttribute('aria-checked');
        expect(checked('form-all-types')).toBe('false');
        expect(checked('form-all-in-archives')).toBe('false');

        clickButton(query('form-all-types'));
        clickButton(query('form-all-in-archives'));
        await settle();
        await submit();

        expect(watchFolders['add']).toHaveBeenCalledWith(
          expect.objectContaining({ allFileTypes: true, allFileTypesInArchives: true })
        );
      });

      describe('already-watched notice', () => {
        const notice = () => query('watch-folders-notice');
        const addExisting = async (switches: string[], created = false) => {
          watchFolders['add'].mockResolvedValue(added(folder('new'), created));
          await fillAddFolder();
          for (const testId of switches) {
            clickButton(query(testId));
            await settle();
          }
          await submit();
        };

        it.each([['form-all-types'], ['form-all-in-archives']])(
          'closes the form and says the file types stay when %s was on for a folder already watched',
          async (toggle) => {
            await setup();

            await addExisting([toggle]);

            expect(query('watch-folder-form')).toBeNull();
            expect(notice()?.textContent).toContain('already watched');
            expect(notice()?.textContent).toContain('stay as they are');
          }
        );

        it('shows no notice when both switches were off', async () => {
          await setup();

          await addExisting([]);

          expect(query('watch-folder-form')).toBeNull();
          expect(notice()).toBeNull();
        });

        it('shows no notice when the add created the folder', async () => {
          await setup();

          await addExisting(['form-all-types', 'form-all-in-archives'], true);

          expect(query('watch-folder-form')).toBeNull();
          expect(notice()).toBeNull();
        });

        it('shows no notice when the add was refused, and keeps the form open', async () => {
          await setup();
          watchFolders['add'].mockRejectedValue(reject('folder', 'Not found'));
          await fillAddFolder();
          clickButton(query('form-all-types'));
          await settle();

          await submit();

          expect(query('watch-folder-form')).not.toBeNull();
          expect(notice()).toBeNull();
        });

        it('shows no notice from an Add device form', async () => {
          await setup({ folders: [folder('a', { allFileTypes: true })] });
          watchFolders['add'].mockResolvedValue(
            added(folder('a', { allFileTypes: true }), false)
          );
          query<HTMLButtonElement>('add-device')?.click();
          await settle();

          await submit();

          expect(query('watch-folder-device-form')).toBeNull();
          expect(notice()).toBeNull();
        });

        it('clears when any form opens', async () => {
          await setup({ folders: [folder('a')] });
          await addExisting(['form-all-types']);
          expect(notice()).not.toBeNull();

          query<HTMLButtonElement>('add-device')?.click();
          await settle();

          expect(notice()).toBeNull();
        });

        it('clears when the panel is reopened', async () => {
          await setup();
          await addExisting(['form-all-types']);
          expect(notice()).not.toBeNull();

          fixture.componentRef.setInput('open', false);
          fixture.detectChanges();
          fixture.componentRef.setInput('open', true);
          fixture.detectChanges();
          await settle();

          expect(notice()).toBeNull();
        });

        it('shows nothing when the form changed before the save resolved', async () => {
          await setup();
          let resolveAdd: (value: ReturnType<typeof added>) => void = () => undefined;
          watchFolders['add'].mockReturnValue(
            new Promise((resolve) => {
              resolveAdd = resolve;
            })
          );
          await fillAddFolder();
          clickButton(query('form-all-types'));
          await settle();
          submitButton()?.click();
          await settle();

          clickButton(query('form-cancel'));
          await settle();
          clickButton(query('add-watch-folder'));
          await settle();
          resolveAdd(added(folder('new'), false));
          await settle();
          await settle();

          expect(query('watch-folder-form')).not.toBeNull();
          expect(notice()).toBeNull();
        });
      });

      it('gates Add on the folder, since the rest starts filled in', async () => {
        await setup();
        clickButton(query('add-watch-folder'));
        await settle();

        expect(submitButton()?.disabled).toBe(true);

        await type('form-folder', '   ');
        expect(submitButton()?.disabled).toBe(true);

        await type('form-folder', 'D:\\Incoming');
        expect(submitButton()?.disabled).toBe(false);

        await type('form-device-path', '  ');
        expect(submitButton()?.disabled).toBe(true);
      });

      it('offers only the storage the chosen device has', async () => {
        await setup();
        clickButton(query('add-watch-folder'));
        await settle();

        await choose('form-device', 'Rack TeensyROM');
        expect(storageDisabled('SD')).toBe(false);
        expect(storageDisabled('USB')).toBe(true);

        await choose('form-device', 'Bench TeensyROM');
        expect(storageDisabled('SD')).toBe(false);
        expect(storageDisabled('USB')).toBe(false);
      });

      it('keeps the chosen storage when the device has it, and falls back to its first when not', async () => {
        await setup();
        clickButton(query('add-watch-folder'));
        await settle();

        await choose('form-device', 'Bench TeensyROM');
        await chooseStorage('USB');
        expect(selectedStorage()).toBe('USB');

        await choose('form-device', 'Rack TeensyROM');
        expect(selectedStorage()).toBe('SD');
      });

      it('saves the trimmed folder and the chosen device, then closes and lists it', async () => {
        await setup();
        watchFolders['add'].mockResolvedValue(
          added(
            folder('new', {
              path: 'D:\\Incoming',
              destinations: [
                {
                  id: 'new-1',
                  deviceId: 'dev-2',
                  deviceName: 'Bench TeensyROM',
                  storageType: StorageType.Sd,
                  path: '/auto-transfer',
                  launch: false,
                },
              ],
            })
          )
        );

        await fillAddFolder();
        await submit();

        expect(watchFolders['add']).toHaveBeenCalledWith({
          path: 'D:\\Incoming',
          deviceId: 'dev-2',
          storageType: StorageType.Sd,
          devicePath: '/auto-transfer',
          launch: false,
          allFileTypes: false,
          allFileTypesInArchives: false,
        });
        expect(query('watch-folder-form')).toBeNull();
        expect(query('watch-folder-path')?.textContent).toContain('D:\\Incoming');
        expect(query('add-watch-folder')?.contains(document.activeElement)).toBe(true);
      });

      it('moves focus to the folder field on open', async () => {
        await setup();
        clickButton(query('add-watch-folder'));
        await settle();

        expect(document.activeElement).toBe(query('form-folder'));
      });

      it.each([
        ['folder', 'error-folder'],
        ['device', 'error-device'],
        ['storage', 'error-storage'],
        ['devicePath', 'error-device-path'],
      ] as const)(
        'shows a %s refusal under that field and keeps the form with its values',
        async (field, errorId) => {
          await setup();
          watchFolders['add'].mockRejectedValue(reject(field, `Refused ${field}`));

          await fillAddFolder();
          await submit();

          expect(errorText(errorId)).toBe(`Refused ${field}`);
          expect(query('error-form')).toBeNull();
          expect(query<HTMLInputElement>('form-folder')?.value).toBe('  D:\\Incoming  ');
          expect(submitButton()?.disabled).toBe(false);
        }
      );

      it('shows a refusal that concerns no field above the buttons', async () => {
        await setup();
        watchFolders['add'].mockRejectedValue(reject(null, 'Engine unavailable'));

        await fillAddFolder();
        await submit();

        expect(errorText('error-form')).toBe('Engine unavailable');
        expect(query('error-folder')).toBeNull();
        expect(query('watch-folder-form')).not.toBeNull();
      });

      it('clears the refusal once a value changes', async () => {
        await setup();
        watchFolders['add'].mockRejectedValue(reject('folder', 'Not found'));

        await fillAddFolder();
        await submit();
        await type('form-folder', 'D:\\Other');

        expect(query('error-folder')).toBeNull();
      });

      it('cancels on the Cancel button and on Escape, returning focus to the add button', async () => {
        await setup();
        clickButton(query('add-watch-folder'));
        await settle();
        clickButton(query('form-cancel'));
        await settle();
        expect(query('watch-folder-form')).toBeNull();
        expect(query('add-watch-folder')?.contains(document.activeElement)).toBe(true);

        clickButton(query('add-watch-folder'));
        await settle();
        query('form-folder')?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
        await settle();
        expect(query('watch-folder-form')).toBeNull();
      });
    });

    describe('add device', () => {
      it('offers only connected devices not already on the folder', async () => {
        await setup({ folders: [folder('a')] });
        query<HTMLButtonElement>('add-device')?.click();
        await settle();

        await openSelect('form-device');
        expect(optionLabels()).toEqual(['Bench TeensyROM']);
      });

      it('starts on the first device the folder is not yet on, with launch off', async () => {
        await setup({ folders: [folder('a')] });
        query<HTMLButtonElement>('add-device')?.click();
        await settle();
        await settle();

        expect(selectedDevice()).toBe('Bench TeensyROM');
        expect(query('form-launch')?.querySelector('button')?.getAttribute('aria-checked')).toBe('false');
      });

      it('takes the device folder and storage of the sharing first device', async () => {
        const first = folder('a');
        await setup({
          folders: [
            folder('a', {
              destinations: [
                { ...first.destinations[0], storageType: StorageType.Usb, path: '/music/new' },
              ],
            }),
          ],
        });
        query<HTMLButtonElement>('add-device')?.click();
        await settle();

        expect(query<HTMLInputElement>('form-device-path')?.value).toBe('/music/new');
        expect(selectedStorage()).toBe('USB');
      });

      it('uses the first available storage when the first device storage is not on the new device', async () => {
        const first = folder('a');
        await setup({
          folders: [
            folder('a', {
              destinations: [
                {
                  ...first.destinations[0],
                  deviceId: 'dev-2',
                  deviceName: 'Bench TeensyROM',
                  storageType: StorageType.Usb,
                  path: '/music/new',
                },
              ],
            }),
          ],
        });
        query<HTMLButtonElement>('add-device')?.click();
        await settle();
        await settle();

        expect(selectedDevice()).toBe('Rack TeensyROM');
        expect(selectedStorage()).toBe('SD');
        expect(query<HTMLInputElement>('form-device-path')?.value).toBe('/music/new');
      });

      it('falls back to /auto-transfer and SD when the folder has no first device to follow', async () => {
        await setup({ folders: [folder('a', { destinations: [] })] });
        query<HTMLButtonElement>('add-device')?.click();
        await settle();

        expect(query<HTMLInputElement>('form-device-path')?.value).toBe('/auto-transfer');
        expect(selectedStorage()).toBe('SD');
      });

      it('falls back to /auto-transfer when the first device has no device folder', async () => {
        const first = folder('a');
        await setup({ folders: [folder('a', { destinations: [{ ...first.destinations[0], path: '' }] })] });
        query<HTMLButtonElement>('add-device')?.click();
        await settle();

        expect(query<HTMLInputElement>('form-device-path')?.value).toBe('/auto-transfer');
      });

      it('starts afresh each time the form is opened', async () => {
        await setup({ folders: [folder('a')] });
        query<HTMLButtonElement>('add-device')?.click();
        await settle();
        await type('form-device-path', '/edited');

        clickButton(query('form-cancel'));
        await settle();
        query<HTMLButtonElement>('add-device')?.click();
        await settle();

        expect(query<HTMLInputElement>('form-device-path')?.value).toBe('/auto-transfer');
      });

      it('offers no Add device once the folder delivers to every connected device', async () => {
        const first = folder('a');
        await setup({
          folders: [
            folder('a', {
              destinations: [
                ...first.destinations,
                { ...first.destinations[0], id: 'a-2', deviceId: 'dev-2', deviceName: 'Bench TeensyROM' },
              ],
            }),
          ],
        });

        expect(query('add-device')).toBeNull();
      });

      it('passes the folder current file-type switches along', async () => {
        await setup({ folders: [folder('a', { allFileTypes: true })] });
        watchFolders['add'].mockResolvedValue(added(folder('a', { allFileTypes: true }), false));
        query<HTMLButtonElement>('add-device')?.click();
        await settle();

        await submit();

        expect(watchFolders['add']).toHaveBeenCalledWith(
          expect.objectContaining({ allFileTypes: true, allFileTypesInArchives: false })
        );
      });

      it('saves through add with the folder path and closes', async () => {
        await setup({ folders: [folder('a')] });
        watchFolders['add'].mockResolvedValue(
          added(
            folder('a', {
              destinations: [
                ...folder('a').destinations,
                {
                  id: 'a-2',
                  deviceId: 'dev-2',
                  deviceName: 'Bench TeensyROM',
                  storageType: StorageType.Usb,
                  path: '/auto-transfer',
                  launch: false,
                },
              ],
            })
          )
        );
        query<HTMLButtonElement>('add-device')?.click();
        await settle();

        await chooseStorage('USB');
        await submit();

        expect(watchFolders['add']).toHaveBeenCalledWith({
          path: 'C:\\Watch\\a',
          deviceId: 'dev-2',
          storageType: StorageType.Usb,
          devicePath: '/auto-transfer',
          launch: false,
          allFileTypes: false,
          allFileTypesInArchives: false,
        });
        expect(query('watch-folder-device-form')).toBeNull();
        expect(queryAll('watch-folder-device-row')).toHaveLength(2);
      });

      it('returns focus to the last device when adding it leaves nothing more to add', async () => {
        await setup({ folders: [folder('a')] });
        watchFolders['add'].mockResolvedValue(
          added(
            folder('a', {
              destinations: [
                ...folder('a').destinations,
                {
                  id: 'a-2',
                  deviceId: 'dev-2',
                  deviceName: 'Bench TeensyROM',
                  storageType: StorageType.Sd,
                  path: '/auto-transfer',
                  launch: false,
                },
              ],
            })
          )
        );
        query<HTMLButtonElement>('add-device')?.click();
        await settle();

        await submit();

        expect(query('add-device')).toBeNull();
        const rows = queryAll('watch-folder-device-row');
        expect(rows[rows.length - 1].contains(document.activeElement)).toBe(true);
      });

      it('returns focus to Add device when the form is cancelled', async () => {
        await setup({ folders: [folder('a')] });
        query<HTMLButtonElement>('add-device')?.click();
        await settle();

        clickButton(query('form-cancel'));
        await settle();

        expect(query('add-device')?.contains(document.activeElement)).toBe(true);
      });

      it('shows a refusal under its field and keeps the form open', async () => {
        await setup({ folders: [folder('a')] });
        watchFolders['add'].mockRejectedValue(reject('devicePath', 'Not a valid device folder'));
        query<HTMLButtonElement>('add-device')?.click();
        await settle();

        await submit();

        expect(errorText('error-device-path')).toBe('Not a valid device folder');
        expect(query('watch-folder-device-form')).not.toBeNull();
      });

      it('shows a refusal about the folder above the buttons', async () => {
        await setup({ folders: [folder('a')] });
        watchFolders['add'].mockRejectedValue(reject('folder', 'Folder is gone'));
        query<HTMLButtonElement>('add-device')?.click();
        await settle();

        await submit();

        expect(errorText('error-form')).toBe('Folder is gone');
      });
    });

    describe('edit device', () => {
      const openEdit = async () => {
        await setup({ folders: [folder('a')] });
        clickButton(query('watch-folder-device-edit'));
        await settle();
      };

      it('replaces the row with a form that shows device and storage read-only, with the note', async () => {
        await openEdit();

        expect(queryAll('watch-folder-device-row')).toHaveLength(0);
        expect(query<HTMLInputElement>('form-device-readonly')?.value).toBe('Rack TeensyROM');
        expect(
          query('form-storage-readonly')?.querySelector('.mat-button-toggle-checked')?.textContent?.trim()
        ).toBe('SD');
        expect(query('form-readonly-note')?.textContent).toContain('remove this and add it again');
        expect(query<HTMLInputElement>('form-device-path')?.value).toBe('/auto-transfer');
        expect(document.activeElement).toBe(query('form-device-path'));
      });

      it('sends only the changed field', async () => {
        await openEdit();
        watchFolders['setDestination'].mockResolvedValue(folder('a'));

        await type('form-device-path', '/games');
        await submit();

        expect(watchFolders['setDestination']).toHaveBeenCalledWith('a', 'dev-1', {
          devicePath: '/games',
        });
        expect(query('watch-folder-device-form')).toBeNull();
        expect(queryAll('watch-folder-device-row')).toHaveLength(1);
        expect(query('watch-folder-device-edit')?.contains(document.activeElement)).toBe(true);
      });

      it('sends the launch switch when it is toggled', async () => {
        await openEdit();
        watchFolders['setDestination'].mockResolvedValue(folder('a'));

        query('form-launch')?.querySelector('button')?.click();
        await settle();
        await submit();

        expect(watchFolders['setDestination']).toHaveBeenCalledWith('a', 'dev-1', {
          launch: false,
        });
      });

      it('closes without a request when nothing changed', async () => {
        await openEdit();

        await submit();

        expect(watchFolders['setDestination']).not.toHaveBeenCalled();
        expect(query('watch-folder-device-form')).toBeNull();
      });

      it('shows a refusal under the device folder and keeps the form open', async () => {
        await openEdit();
        watchFolders['setDestination'].mockRejectedValue(reject('devicePath', 'Bad path'));

        await type('form-device-path', '/x');
        await submit();

        expect(errorText('error-device-path')).toBe('Bad path');
        expect(query<HTMLInputElement>('form-device-path')?.value).toBe('/x');
      });
    });

    it('keeps one form open at a time', async () => {
      await setup({ folders: [folder('a'), folder('b')] });

      clickButton(query('add-watch-folder'));
      await settle();
      expect(query('watch-folder-form')).not.toBeNull();

      queryAll('add-device')[0].click();
      await settle();
      expect(query('watch-folder-form')).toBeNull();
      expect(queryAll('watch-folder-device-form')).toHaveLength(1);

      clickButton(queryAll('watch-folder-device-edit')[1]);
      await settle();
      expect(queryAll('watch-folder-device-form')).toHaveLength(1);
      expect(query('form-device-readonly')).not.toBeNull();
    });
  });

  it('moves focus to the first Uploads switch', async () => {
    await setup();

    fixture.componentInstance.focusEntry();

    expect(native().contains(document.activeElement)).toBe(true);
    expect(query('auto-launch-switch')?.contains(document.activeElement)).toBe(true);
  });
});
