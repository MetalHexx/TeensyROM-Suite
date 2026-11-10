import { updateState } from '../../with-devtools';
import { createAction } from '@teensyrom-nx/utils';
import { DjState, WritableStore } from '../dj-store';

/** Sets the timing helper's settings: the lookahead and whether it is switched on. A field left out
 *  keeps its value. */
export function setSendSettings(store: WritableStore<DjState>) {
  return {
    setSendSettings: ({
      lookaheadMs,
      senderEnabled,
    }: {
      lookaheadMs?: number;
      senderEnabled?: boolean;
    }): void => {
      const actionMessage = createAction('set-send-settings');

      updateState(store, actionMessage, (state) => ({
        send: {
          ...state.send,
          ...(lookaheadMs === undefined ? {} : { lookaheadMs }),
          ...(senderEnabled === undefined ? {} : { senderEnabled }),
        },
      }));
    },
  };
}
