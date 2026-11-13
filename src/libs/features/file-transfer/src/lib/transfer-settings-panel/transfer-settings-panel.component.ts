import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, Validators } from '@angular/forms';
import { MatSlideToggle, MatSlideToggleModule } from '@angular/material/slide-toggle';
import { merge } from 'rxjs';
import { DeviceStore, SettingsStore, WatchFolderStore } from '@teensyrom-nx/application';
import {
  Device,
  FileTransferSettings,
  StorageType,
  WatchFolder,
  WatchFolderDestination,
  WatchFolderDestinationChange,
  WatchFolderField,
  WatchFolderFileTypesChange,
  WatchFolderRejection,
  WatchFolderState,
} from '@teensyrom-nx/domain';
import {
  IconButtonComponent,
  SidePanelComponent,
  TooltipConfig,
  TooltipDirective,
  TooltipPosition,
} from '@teensyrom-nx/ui/components';
import { WatchFolderRowComponent } from './watch-folder-row/watch-folder-row.component';
import { WatchFolderDeviceRowComponent } from './watch-folder-device-row/watch-folder-device-row.component';
import { WatchFolderFormComponent } from './watch-folder-form/watch-folder-form.component';
import { WatchFolderDeviceFormComponent } from './watch-folder-device-form/watch-folder-device-form.component';
import {
  DEFAULT_DEVICE_PATH,
  WatchFolderFormErrors,
  availableStorage,
  notBlank,
} from './watch-folder-form.util';

/** The single form open in the panel. */
type OpenForm =
  | { kind: 'add-folder' }
  | { kind: 'add-device'; watchFolderId: string }
  | { kind: 'edit-device'; watchFolderId: string; deviceId: string };

/**
 * The File Transfer view side panel: the Uploads switches and the list of watch folders with their
 * devices. It reloads the list and re-reads the Uploads switches every time it opens, since the
 * engine can change them while the panel is closed. Rows and forms are presentational; this container owns the
 * store calls, the form groups, which single form is open, and where the engine's refusals show.
 */
const ALREADY_WATCHED_NOTICE =
  "That folder is already watched, so its file types stay as they are. Use the folder's own switches to change them.";

@Component({
  selector: 'lib-transfer-settings-panel',
  imports: [
    MatSlideToggleModule,
    SidePanelComponent,
    IconButtonComponent,
    TooltipDirective,
    WatchFolderRowComponent,
    WatchFolderDeviceRowComponent,
    WatchFolderFormComponent,
    WatchFolderDeviceFormComponent,
  ],
  templateUrl: './transfer-settings-panel.component.html',
  styleUrl: './transfer-settings-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TransferSettingsPanelComponent {
  private readonly settingsStore = inject(SettingsStore);
  private readonly watchFolderStore = inject(WatchFolderStore);
  private readonly deviceStore = inject(DeviceStore);
  private readonly fb = inject(FormBuilder);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly uploadsSwitch = viewChild<MatSlideToggle>('uploadsSwitch');

  /** Whether the panel is open; the list and the Uploads switches reload each time this becomes true. */
  readonly open = input(false);
  /** Duration in milliseconds of the panel card own entry; `0` for reduced motion. */
  readonly animationDuration = input(400);

  /** Emits when the panel close button is pressed. */
  readonly closePanel = output<void>();

  protected readonly WatchFolderState = WatchFolderState;

  protected readonly autoLaunchTooltip: TooltipConfig = {
    body: "Launch one file after an upload. Watch folders use each device's own Auto launch.",
    position: TooltipPosition.Top,
  };
  protected readonly allTypesInFoldersTooltip: TooltipConfig = {
    body: 'Send every file in a folder you upload, not only the types the TeensyROM recognizes. Files you pick are always sent.',
    position: TooltipPosition.Top,
  };
  protected readonly allTypesInArchivesTooltip: TooltipConfig = {
    body: 'Send everything inside an archive you upload, not only the types the TeensyROM recognizes.',
    position: TooltipPosition.Top,
  };
  protected readonly addFolderTooltip: TooltipConfig = {
    body: 'Watch another folder on this computer.',
    position: TooltipPosition.Left,
  };
  protected readonly addDeviceTooltip: TooltipConfig = {
    body: "Send this folder's files to another device too.",
    position: TooltipPosition.Top,
  };

  protected readonly folders = this.watchFolderStore.getFolders();
  protected readonly error = this.watchFolderStore.error;
  protected readonly isLoading = this.watchFolderStore.isLoading;

  protected readonly settingsError = this.settingsStore.error;

  private readonly settings = this.settingsStore.getSettings();
  protected readonly settingsReady = computed(() => this.settings() !== null);
  protected readonly autoLaunch = computed(
    () => this.settings()?.fileTransferSettings.autoLaunchOnCopyEnabled ?? false
  );
  protected readonly allTypesInFolders = computed(
    () => this.settings()?.fileTransferSettings.allFileTypesInFolders ?? false
  );
  protected readonly allTypesInArchives = computed(
    () => this.settings()?.fileTransferSettings.allFileTypesInArchives ?? false
  );

  protected readonly openForm = signal<OpenForm | null>(null);
  protected readonly submitting = signal(false);
  /** The engine's refusal of the open form, by the field it concerns. */
  protected readonly formErrors = signal<WatchFolderFormErrors>({});
  /** Shown when an added folder was already watched, so the file-type switches it was added with did not apply. */
  protected readonly notice = signal<string | null>(null);

  protected readonly addFolderForm = this.fb.nonNullable.group({
    folder: ['', [Validators.required, notBlank]],
    device: ['', Validators.required],
    storage: this.fb.nonNullable.control<StorageType | ''>('', Validators.required),
    devicePath: [DEFAULT_DEVICE_PATH, [Validators.required, notBlank]],
    launch: [false],
    allFileTypes: [false],
    allFileTypesInArchives: [false],
  });
  protected readonly addDeviceForm = this.fb.nonNullable.group({
    device: ['', Validators.required],
    storage: this.fb.nonNullable.control<StorageType | ''>('', Validators.required),
    devicePath: [DEFAULT_DEVICE_PATH, [Validators.required, notBlank]],
    launch: [false],
  });
  protected readonly editDeviceForm = this.fb.nonNullable.group({
    devicePath: ['', [Validators.required, notBlank]],
    launch: [false],
  });

  /** Connected devices a new folder can deliver to. */
  protected readonly connectedDevices = this.deviceStore.usableDevices;

  /** Connected devices the folder of the open add-device form is not yet delivering to. */
  protected readonly addDeviceChoices = computed<Device[]>(() => {
    const open = this.openForm();
    if (open?.kind !== 'add-device') return [];
    const taken = new Set(
      this.folders()
        .find((folder) => folder.id === open.watchFolderId)
        ?.destinations.map((destination) => destination.deviceId)
    );
    return this.connectedDevices().filter((device) => !taken.has(device.deviceId));
  });

  constructor() {
    effect(() => {
      if (this.open()) {
        untracked(() => {
          this.notice.set(null);
          void this.watchFolderStore.loadWatchFolders();
          void this.settingsStore.refreshFileTransferSettings();
        });
      }
    });

    this.addFolderForm.controls.device.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((deviceId) =>
        this.selectAvailableStorage(this.addFolderForm.controls.storage, this.connectedDevices(), deviceId)
      );
    this.addDeviceForm.controls.device.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((deviceId) =>
        this.selectAvailableStorage(this.addDeviceForm.controls.storage, this.addDeviceChoices(), deviceId)
      );
    merge(
      this.addFolderForm.valueChanges,
      this.addDeviceForm.valueChanges,
      this.editDeviceForm.valueChanges
    )
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.formErrors.set({}));
  }

  /** Moves keyboard focus to the first Uploads switch. */
  focusEntry(): void {
    this.uploadsSwitch()?.focus();
  }

  /**
   * Saves one Uploads switch on its own. The toggle snaps back to the stored value first and
   * moves only when the store takes the saved value, so a failed save leaves it where it was.
   */
  protected async onUploadSettingChange(
    toggle: MatSlideToggle,
    key: keyof FileTransferSettings,
    checked: boolean
  ): Promise<void> {
    toggle.checked = this.settings()?.fileTransferSettings[key] ?? false;
    await this.settingsStore.saveFileTransferSettings({ [key]: checked });
  }

  protected isPending(watchFolderId: string): boolean {
    return this.watchFolderStore.isPending(watchFolderId)();
  }

  protected isDimmed(folder: WatchFolder): boolean {
    return folder.state === WatchFolderState.Off;
  }

  protected onEnabledChange(watchFolderId: string, enabled: boolean): void {
    void this.watchFolderStore.setFolderEnabled({ watchFolderId, enabled });
  }

  protected onFileTypesChange(watchFolderId: string, change: WatchFolderFileTypesChange): void {
    void this.watchFolderStore.setFolderFileTypes({ watchFolderId, change });
  }

  protected onDeleteFolder(watchFolderId: string): void {
    void this.watchFolderStore.removeFolder({ watchFolderId });
  }

  protected onDeleteDevice(watchFolderId: string, deviceId: string): void {
    void this.watchFolderStore.removeDestination({ watchFolderId, deviceId });
  }

  protected isAddingDevice(watchFolderId: string): boolean {
    const open = this.openForm();
    return open?.kind === 'add-device' && open.watchFolderId === watchFolderId;
  }

  protected isEditingDevice(watchFolderId: string, deviceId: string): boolean {
    const open = this.openForm();
    return (
      open?.kind === 'edit-device' &&
      open.watchFolderId === watchFolderId &&
      open.deviceId === deviceId
    );
  }

  /** Whether a connected device is left that the folder is not yet delivering to. */
  protected canAddDevice(folder: WatchFolder): boolean {
    const taken = new Set(folder.destinations.map((destination) => destination.deviceId));
    return this.connectedDevices().some((device) => !taken.has(device.deviceId));
  }

  /** Opens with the first connected device and its first storage chosen. */
  protected openAddFolder(): void {
    this.addFolderForm.reset();
    this.show({ kind: 'add-folder' });
    this.addFolderForm.controls.device.setValue(this.connectedDevices()[0]?.deviceId ?? '');
  }

  /**
   * Opens with the folder's first device as the pattern: the device folder and storage it uses,
   * falling back to the defaults, and the first device the folder is not yet delivering to.
   */
  protected openAddDevice(watchFolderId: string): void {
    const first = this.folders().find((folder) => folder.id === watchFolderId)?.destinations[0];
    this.addDeviceForm.reset();
    this.addDeviceForm.patchValue({
      storage: first?.storageType ?? StorageType.Sd,
      devicePath: first?.path || DEFAULT_DEVICE_PATH,
    });
    this.show({ kind: 'add-device', watchFolderId });
    this.addDeviceForm.controls.device.setValue(this.addDeviceChoices()[0]?.deviceId ?? '');
  }

  protected openEditDevice(watchFolderId: string, deviceId: string): void {
    const destination = this.findDestination(watchFolderId, deviceId);
    if (!destination) return;
    this.editDeviceForm.reset({ devicePath: destination.path, launch: destination.launch });
    this.show({ kind: 'edit-device', watchFolderId, deviceId });
  }

  /** Closes the open form, if any, and returns focus to the button that opened it. */
  protected closeForm(): void {
    const closing = this.openForm();
    if (!closing) return;
    this.openForm.set(null);
    this.formErrors.set({});
    afterNextRender(() => this.openerButton(closing)?.focus(), { injector: this.injector });
  }

  private findDestination(
    watchFolderId: string,
    deviceId: string
  ): WatchFolderDestination | undefined {
    return this.folders()
      .find((folder) => folder.id === watchFolderId)
      ?.destinations.find((destination) => destination.deviceId === deviceId);
  }

  protected submitAddFolder(): void {
    const { folder, device, storage, devicePath, launch, allFileTypes, allFileTypesInArchives } =
      this.addFolderForm.getRawValue();
    if (this.addFolderForm.invalid || storage === '') return;
    let created = true;
    void this.submitForm(
      async () => {
        const outcome = await this.watchFolderStore.addWatchFolder({
          path: folder.trim(),
          deviceId: device,
          storageType: storage,
          devicePath,
          launch,
          allFileTypes,
          allFileTypesInArchives,
        });
        if (!outcome.rejection) created = outcome.created;
        return outcome.rejection;
      },
      ['folder', 'device', 'storage', 'devicePath'],
      () => {
        if (!created && (allFileTypes || allFileTypesInArchives)) {
          this.notice.set(ALREADY_WATCHED_NOTICE);
        }
      }
    );
  }

  protected submitAddDevice(watchFolderId: string): void {
    const folder = this.folders().find((candidate) => candidate.id === watchFolderId);
    const { device, storage, devicePath, launch } = this.addDeviceForm.getRawValue();
    if (!folder || this.addDeviceForm.invalid || storage === '') return;
    void this.submitForm(
      async () =>
        (
          await this.watchFolderStore.addWatchFolder({
            path: folder.path,
            deviceId: device,
            storageType: storage,
            devicePath,
            launch,
            allFileTypes: folder.allFileTypes,
            allFileTypesInArchives: folder.allFileTypesInArchives,
          })
        ).rejection,
      ['device', 'storage', 'devicePath']
    );
  }

  protected submitEditDevice(watchFolderId: string, deviceId: string): void {
    const destination = this.findDestination(watchFolderId, deviceId);
    if (!destination || this.editDeviceForm.invalid) return;
    const { devicePath, launch } = this.editDeviceForm.getRawValue();
    const change: WatchFolderDestinationChange = {};
    if (devicePath !== destination.path) change.devicePath = devicePath;
    if (launch !== destination.launch) change.launch = launch;
    if (Object.keys(change).length === 0) {
      this.closeForm();
      return;
    }
    void this.submitForm(
      () => this.watchFolderStore.setDestination({ watchFolderId, deviceId, change }),
      ['devicePath']
    );
  }

  /**
   * Runs a save for the open form. A refusal shows under the field it concerns when the form has
   * that field, otherwise above the buttons, and the form stays open; a save closes the form.
   * The result is dropped if the user has moved on to another form meanwhile. `onSaved` runs only
   * when the save closed the form as submitted.
   */
  private async submitForm(
    save: () => Promise<WatchFolderRejection | null>,
    fields: WatchFolderField[],
    onSaved?: () => void
  ): Promise<void> {
    if (this.submitting()) return;
    const submitted = this.openForm();
    this.submitting.set(true);
    this.formErrors.set({});
    try {
      const rejection = await save();
      if (this.openForm() !== submitted) return;
      if (rejection) {
        const key = rejection.field && fields.includes(rejection.field) ? rejection.field : 'form';
        this.formErrors.set({ [key]: rejection.message });
      } else {
        this.closeForm();
        onSaved?.();
      }
    } finally {
      this.submitting.set(false);
    }
  }

  private show(form: OpenForm): void {
    this.formErrors.set({});
    this.notice.set(null);
    this.openForm.set(form);
  }

  /** Picks the device's first available storage when the chosen one is not available on it. */
  private selectAvailableStorage(
    storage: FormControl<StorageType | ''>,
    devices: Device[],
    deviceId: string
  ): void {
    const options = availableStorage(devices.find((device) => device.deviceId === deviceId));
    const current = storage.value;
    if (current === '' || !options.includes(current)) {
      storage.setValue(options[0] ?? '');
    }
  }

  private openerButton(opener: OpenForm): HTMLElement | null {
    const host = this.host.nativeElement;
    const find = (selector: string, matches: (el: HTMLElement) => boolean = () => true) =>
      Array.from(host.querySelectorAll<HTMLElement>(selector)).find(matches) ?? null;

    switch (opener.kind) {
      case 'add-folder':
        return find('[data-testid="add-watch-folder"] button');
      case 'add-device': {
        const link = find(
          '[data-testid="add-device"]',
          (el) => el.dataset['folderId'] === opener.watchFolderId
        );
        if (link) return link;
        // The link is gone once the folder delivers to every connected device; land on its last one.
        const rows = Array.from(
          host.querySelectorAll<HTMLElement>('lib-watch-folder-device-row')
        ).filter((el) => el.dataset['folderId'] === opener.watchFolderId);
        return (
          rows[rows.length - 1]?.querySelector<HTMLElement>(
            '[data-testid="watch-folder-device-edit"] button'
          ) ?? null
        );
      }
      case 'edit-device':
        return (
          find(
            'lib-watch-folder-device-row',
            (el) =>
              el.dataset['folderId'] === opener.watchFolderId &&
              el.dataset['deviceId'] === opener.deviceId
          )?.querySelector<HTMLElement>('[data-testid="watch-folder-device-edit"] button') ?? null
        );
    }
  }
}
