import { firstValueFrom } from 'rxjs';
import { StorageType, IStorageService } from '@teensyrom-nx/domain';
import { StorageState } from '../storage-store';
import { StorageKeyUtil } from '../storage-key.util';
import {
  WritableStore,
  dropListingsBelowPath,
  getStorage,
  normalizePathForCompare,
  updateStorage,
} from '../storage-helpers';
import { refreshDirectory } from './refresh-directory';
import { logError, logInfo, logWarn, LogType, createAction } from '@teensyrom-nx/utils';

export function refreshAfterIndex(
  store: WritableStore<StorageState>,
  storageService: IStorageService
) {
  return {
    /**
     * Brings the store in line after the API re-indexed the folder at `path` and everything below
     * it: refetches the shown folder, drops the cached listings below `path` so they reload when
     * opened, and refetches the listing at `path` itself.
     */
    refreshAfterIndex: async ({
      deviceId,
      storageType,
      path,
    }: {
      deviceId: string;
      storageType: StorageType;
      path: string;
    }): Promise<void> => {
      const actionMessage = createAction('refresh-after-index');
      const key = StorageKeyUtil.create(deviceId, storageType);
      const entry = getStorage(store, key);

      if (!entry) {
        logWarn(`Cannot refresh after index - no entry found for ${key}`);
        return;
      }

      const shownPath = entry.currentPath;
      await refreshDirectory(store, storageService).refreshDirectory({ deviceId, storageType });

      dropListingsBelowPath(store, key, path, actionMessage);

      // The shown folder's own listing was just refreshed above.
      if (normalizePathForCompare(path) === normalizePathForCompare(shownPath)) {
        return;
      }

      try {
        const directory = await firstValueFrom(storageService.getDirectory(deviceId, storageType, path));
        updateStorage(
          store,
          key,
          {
            directoryListings: {
              ...getStorage(store, key)?.directoryListings,
              [path]: directory.directories,
            },
          },
          actionMessage
        );
        logInfo(LogType.Finish, `Refresh after index completed for ${key} at ${path}`);
      } catch (error) {
        logError(`Refetching ${path} after index failed for ${key}:`, error);
      }
    },
  };
}
