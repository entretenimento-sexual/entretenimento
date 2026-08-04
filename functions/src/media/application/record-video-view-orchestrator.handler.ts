import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  assertInteractionAccess,
} from '../../account_lifecycle/interaction-access.policy';
import { MEDIA_VIEW_CALLABLE_OPTIONS } from './media-app-check.options';
import {
  recordVideoView as recordVideoViewCore,
} from './record-video-view.handler';

export const recordVideoView = onCall(
  MEDIA_VIEW_CALLABLE_OPTIONS,
  async (request) => {
    const viewerUid = String(request.auth?.uid ?? '').trim();

    if (request.app?.alreadyConsumed === true) {
      throw new HttpsError(
        'permission-denied',
        'A validação de integridade desta solicitação já foi utilizada.'
      );
    }

    if (viewerUid) {
      await assertInteractionAccess(viewerUid);
    }

    return recordVideoViewCore.run(request as any);
  }
);
