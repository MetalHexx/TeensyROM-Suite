import { updateState } from '../../with-devtools';
import { IWatchFolderService, WatchFolderFileTypesChange } from '@teensyrom-nx/domain';
import { createAction, logInfo, logError, LogType } from '@teensyrom-nx/utils';
import { WatchFolderStoreState } from '../watch-folder-store';
import { WritableStore, setPending, upsertFolder } from '../watch-folder-helpers';

export interface SetFolderFileTypesParams {
  watchFolderId: string;
  change: WatchFolderFileTypesChange;
}

export function setFolderFileTypes(
  store: WritableStore<WatchFolderStoreState>,
  service: IWatchFolderService
) {
  return {
    setFolderFileTypes: async ({
      watchFolderId,
      change,
    }: SetFolderFileTypesParams): Promise<void> => {
      const actionMessage = createAction('set-folder-file-types');
      logInfo(LogType.Start, 'SetFolderFileTypes: Changing watch folder file types', {
        actionMessage,
        watchFolderId,
        change,
      });

      updateState(store, actionMessage, (state) => ({ ...state, error: null }));
      setPending(store, actionMessage, watchFolderId, true);

      try {
        const folder = await service.setFileTypes(watchFolderId, change);
        logInfo(LogType.Success, 'SetFolderFileTypes: Watch folder file types changed', {
          watchFolderId,
        });
        updateState(store, actionMessage, (state) => ({
          ...state,
          folders: upsertFolder(state.folders, folder),
          lastUpdated: Date.now(),
        }));
      } catch (error) {
        logError('SetFolderFileTypes: Failed to change the watch folder file types', error);
        updateState(store, actionMessage, (state) => ({
          ...state,
          error: (error as Error)?.message || 'Failed to change the watch folder file types',
        }));
      } finally {
        setPending(store, actionMessage, watchFolderId, false);
        logInfo(LogType.Finish, 'SetFolderFileTypes: Change finished', { watchFolderId });
      }
    },
  };
}
