import { onCall } from 'firebase-functions/v2/https';

import {
  assertInteractionAccess,
} from '../../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  recordPhotoView as recordPhotoViewCore,
} from './record-photo-view.handler';

export const recordPhotoView = onCall(
  { region: FUNCTIONS_REGION },
  async (request) => {
    const viewerUid = String(request.auth?.uid ?? '').trim();

    if (viewerUid) {
      await assertInteractionAccess(viewerUid);
    }

    return recordPhotoViewCore.run(request as any);
  }
);
