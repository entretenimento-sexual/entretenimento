import { onCall } from 'firebase-functions/v2/https';

import {
  assertInteractionAccess,
} from '../../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  recordVideoView as recordVideoViewCore,
} from './record-video-view.handler';

export const recordVideoView = onCall(
  { region: FUNCTIONS_REGION },
  async (request) => {
    const viewerUid = String(request.auth?.uid ?? '').trim();

    if (viewerUid) {
      await assertInteractionAccess(viewerUid);
    }

    return recordVideoViewCore.run(request as any);
  }
);
