import { updateState } from '../../with-devtools';
import { firstValueFrom } from 'rxjs';
import { FileTransferSettings, ISettingsService, Settings } from '@teensyrom-nx/domain';
import { createAction, logInfo, logError, LogType } from '@teensyrom-nx/utils';
import { SettingsState } from '../settings-state.interface';
import { WritableStore } from './index';

/**
 * Replaces the upload settings everywhere the store keeps a copy: the current settings, the
 * stored current and every history entry. They are not part of the Settings view's undo, so no
 * snapshot may keep a stale value.
 */
function applyFileTransferSettings(
  state: SettingsState,
  fileTransferSettings: FileTransferSettings
): Pick<SettingsState, 'settings' | 'storedCurrent' | 'history'> {
  const withValues = (settings: Settings): Settings => ({ ...settings, fileTransferSettings });
  return {
    settings: state.settings ? withValues(state.settings) : state.settings,
    storedCurrent: state.storedCurrent ? withValues(state.storedCurrent) : state.storedCurrent,
    history: state.history.map(withValues),
  };
}

export function saveFileTransferSettings(
  writableStore: WritableStore<SettingsState>,
  settingsService: ISettingsService
) {
  return {
    /** Saves only the given upload switches through the narrow endpoint. */
    saveFileTransferSettings: async (change: Partial<FileTransferSettings>): Promise<void> => {
      const actionMessage = createAction('save-file-transfer-settings');

      logInfo(LogType.Start, 'SaveFileTransferSettings: Saving upload settings', {
        actionMessage,
        change,
      });

      updateState(writableStore, actionMessage, (state) => ({
        ...state,
        isSaving: true,
        error: null,
      }));

      try {
        const saved = await firstValueFrom(settingsService.saveFileTransferSettings(change));

        updateState(writableStore, actionMessage, (state) => ({
          ...state,
          ...applyFileTransferSettings(state, saved),
          isSaving: false,
          error: null,
        }));

        logInfo(LogType.Finish, 'SaveFileTransferSettings: Upload settings saved');
      } catch (error) {
        const errorMessage = (error as Error)?.message || 'Failed to save upload settings';
        logError('SaveFileTransferSettings: Failed to save upload settings:', error);

        updateState(writableStore, actionMessage, (state) => ({
          ...state,
          isSaving: false,
          error: errorMessage,
        }));
      }
    },

    /**
     * Re-reads the engine's upload settings without touching the rest of the document or the
     * undo history, so a change made elsewhere shows up. Returns the value it read, or null when
     * the read failed, so callers do not depend on the settings document having been loaded.
     */
    refreshFileTransferSettings: async (): Promise<FileTransferSettings | null> => {
      const actionMessage = createAction('refresh-file-transfer-settings');

      try {
        const current = await firstValueFrom(settingsService.getFileTransferSettings());

        updateState(writableStore, actionMessage, (state) => ({
          ...state,
          ...applyFileTransferSettings(state, current),
        }));

        return current;
      } catch (error) {
        logError('RefreshFileTransferSettings: Failed to re-read upload settings:', error);
        return null;
      }
    },
  };
}
