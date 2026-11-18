import { inject } from '@angular/core';
import { patchState, WritableStateSource } from '@ngrx/signals';
import { IStorageService, DEVICE_STORAGE_SERVICE, StorageType } from '@teensyrom-nx/domain';
import { firstValueFrom } from 'rxjs';
import { DeviceState } from '../device-store';

type SignalStore<T> = {
  [K in keyof T]: () => T[K];
};

/** True when the index covers the whole storage: no starting path, or the root. */
function isFullIndex(startingPath?: string): boolean {
  return !startingPath || startingPath === '/';
}

export function indexStorage(
  store: SignalStore<DeviceState> & WritableStateSource<DeviceState>,
  storageService: IStorageService = inject(DEVICE_STORAGE_SERVICE)
) {
  return {
    /**
     * Indexes a device's storage, or only the folder at `startingPath` and everything below it.
     * Drives `isIndexing` for either. Marks the storage as indexed (`indexExists`) only for a
     * full index, since a partial one leaves the rest of the storage as it was.
     *
     * @returns `true` when the index succeeded, `false` when it failed (the error is also stored).
     */
    indexStorage: async (
      deviceId: string,
      storageType: StorageType,
      startingPath?: string
    ): Promise<boolean> => {
      patchState(store, { isIndexing: true, error: null });
      try {
        await firstValueFrom(storageService.index(deviceId, storageType, startingPath));

        if (!isFullIndex(startingPath)) {
          patchState(store, { isIndexing: false });
          return true;
        }

        const devices = store.devices();
        const updatedDevices = devices.map(device => {
          if (device.deviceId !== deviceId) {
            return device;
          }

          if (storageType === StorageType.Sd) {
            return {
              ...device,
              sdStorage: device.sdStorage ? { ...device.sdStorage, indexExists: true } as typeof device.sdStorage : device.sdStorage
            };
          } else {
            return {
              ...device,
              usbStorage: device.usbStorage ? { ...device.usbStorage, indexExists: true } as typeof device.usbStorage : device.usbStorage
            };
          }
        });

        patchState(store, { devices: updatedDevices, isIndexing: false });
        return true;
      } catch (error) {
        patchState(store, { isIndexing: false, error: String(error) });
        return false;
      }
    },
  };
}
