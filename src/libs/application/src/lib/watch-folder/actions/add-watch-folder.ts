import { updateState } from '../../with-devtools';
import { AddWatchFolderInput, IWatchFolderService, WatchFolderRejection } from '@teensyrom-nx/domain';
import { createAction, logInfo, logError, LogType } from '@teensyrom-nx/utils';
import { WatchFolderStoreState } from '../watch-folder-store';
import { WritableStore, toRejection, upsertFolder } from '../watch-folder-helpers';

/**
 * What an add came to: refused with a rejection, or saved, with `created` false when the device
 * joined a folder that was already watched.
 */
export type AddWatchFolderOutcome =
  | { rejection: WatchFolderRejection }
  | { rejection: null; created: boolean };

/**
 * Adds a folder, or a device to a folder already watched. Resolves to the outcome so the calling
 * form can stay open and show a rejection; a rejection is not written to `error`.
 */
export function addWatchFolder(
  store: WritableStore<WatchFolderStoreState>,
  service: IWatchFolderService
) {
  return {
    addWatchFolder: async (input: AddWatchFolderInput): Promise<AddWatchFolderOutcome> => {
      const actionMessage = createAction('add-watch-folder');
      logInfo(LogType.Start, 'AddWatchFolder: Adding watch folder', {
        actionMessage,
        deviceId: input.deviceId,
      });

      try {
        const { watchFolder: folder, created } = await service.add(input);
        logInfo(LogType.Success, 'AddWatchFolder: Watch folder saved', { watchFolderId: folder.id });
        updateState(store, actionMessage, (state) => ({
          ...state,
          folders: upsertFolder(state.folders, folder),
          lastUpdated: Date.now(),
        }));
        return { rejection: null, created };
      } catch (error) {
        logError('AddWatchFolder: Watch folder was not saved', error);
        return { rejection: toRejection(error, 'Failed to add the watch folder') };
      } finally {
        logInfo(LogType.Finish, 'AddWatchFolder: Add finished');
      }
    },
  };
}
