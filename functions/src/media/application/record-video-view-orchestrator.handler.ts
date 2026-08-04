import { onCall } from 'firebase-functions/v2/https';

import {
  assertInteractionAccess,
} from '../../account_lifecycle/interaction-access.policy';
import {
  recordVideoView as recordVideoViewCore,
} from './record-video-view.handler';
import { VIDEO_PUBLIC_CALLABLE_OPTIONS } from './video-callable-security.options';

export const recordVideoView = onCall(
  VIDEO_PUBLIC_CALLABLE_OPTIONS,
  async (request) => {
    const viewerUid = String(request.auth?.uid ?? '').trim();

    if (viewerUid) {
      await assertInteractionAccess(viewerUid);
    }

    return recordVideoViewCore.run(request as any);
  }
);
