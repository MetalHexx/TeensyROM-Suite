import { IStorageService } from '@teensyrom-nx/domain';
import { createAction } from '@teensyrom-nx/utils';
import { StorageState } from '../storage-store';
import { StorageKeyUtil } from '../storage-key.util';
import { WritableStore, refetchDirectoryQuietly } from '../storage-helpers';

export function refetchShownFolders(
  store: WritableStore<StorageState>,
  storageService: IStorageService
) {
  return {
    /**
     * Refetches the folder every storage entry is showing, once and quietly. Used after the
     * transfer hub reconnects, when jobs may have ended without this tab hearing of it.
     */
    refetchShownFolders: async (): Promise<void> => {
      const actionMessage = createAction('refetch-shown-folders');
      const shown = Object.values(store.storageEntries()).filter((entry) => entry.isLoaded);

      await Promise.all(
        shown.map((entry) =>
          refetchDirectoryQuietly(
            store,
            storageService,
            StorageKeyUtil.create(entry.deviceId, entry.storageType),
            entry.currentPath,
            actionMessage
          )
        )
      );
    },
  };
}
