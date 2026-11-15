import { firstValueFrom } from 'rxjs';
import { IStorageService, StorageType } from '@teensyrom-nx/domain';
import { createAction, logWarn } from '@teensyrom-nx/utils';
import { StorageState } from '../storage-store';
import { StorageKeyUtil } from '../storage-key.util';
import { updateState } from '../../with-devtools';
import {
  WritableStore,
  dropListingsBelowPath,
  getStorage,
  normalizePathForCompare,
  refetchDirectoryQuietly,
} from '../storage-helpers';

/** True when `outer` is `inner` or one of its ancestors; both are normalized. */
function isSameOrAncestor(outer: string, inner: string): boolean {
  return outer === inner || inner.startsWith(`${outer}/`);
}

export function refetchAfterTransfer(
  store: WritableStore<StorageState>,
  storageService: IStorageService
) {
  /** Re-runs the device's active search with its own query, leaving the shown results in place. */
  async function rerunActiveSearch(deviceId: string, actionMessage: string): Promise<void> {
    const search = store.searchState()[deviceId];
    if (!search?.hasSearched || !search.searchText) return;

    try {
      const results = await firstValueFrom(
        storageService.search(deviceId, search.searchText, search.filterType ?? undefined)
      );
      updateState(store, actionMessage, (state) => {
        const current = state.searchState[deviceId];
        if (
          !current ||
          current.searchText !== search.searchText ||
          current.filterType !== search.filterType
        ) {
          return state;
        }
        return { searchState: { ...state.searchState, [deviceId]: { ...current, results } } };
      });
    } catch (error) {
      logWarn(
        `Quiet search refetch failed for device ${deviceId}; keeping the results - ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return {
    /**
     * Brings every listing that shows the destination of an ended transfer up to date, quietly:
     * the shown folder when it is the destination, an ancestor or inside it; the tree listings of
     * the destination and its loaded ancestors; and the device's active search. Listings below the
     * destination are dropped so they reload when opened. Paths compare ignoring case and a
     * trailing `/`.
     */
    refetchAfterTransfer: async ({
      deviceId,
      storageType,
      destinationDirectory,
    }: {
      deviceId: string;
      storageType: StorageType;
      destinationDirectory: string;
    }): Promise<void> => {
      const actionMessage = createAction('refetch-after-transfer');
      const key = StorageKeyUtil.create(deviceId, storageType);
      const destination = normalizePathForCompare(destinationDirectory);
      const work: Promise<void>[] = [rerunActiveSearch(deviceId, actionMessage)];

      const entry = getStorage(store, key);
      if (entry) {
        dropListingsBelowPath(store, key, destinationDirectory, actionMessage);

        const shown = normalizePathForCompare(entry.currentPath);
        const paths = new Map<string, string>();
        if (
          entry.isLoaded &&
          (isSameOrAncestor(shown, destination) || isSameOrAncestor(destination, shown))
        ) {
          paths.set(shown, entry.currentPath);
        }
        for (const listingPath of Object.keys(getStorage(store, key)?.directoryListings ?? {})) {
          const normalized = normalizePathForCompare(listingPath);
          if (isSameOrAncestor(normalized, destination) && !paths.has(normalized)) {
            paths.set(normalized, listingPath);
          }
        }

        for (const path of paths.values()) {
          work.push(refetchDirectoryQuietly(store, storageService, key, path, actionMessage));
        }
      }

      await Promise.all(work);
    },
  };
}
