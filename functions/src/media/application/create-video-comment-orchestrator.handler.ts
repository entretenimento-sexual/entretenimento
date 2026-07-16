import { onCall } from 'firebase-functions/v2/https';

import {
  assertInteractionAccess,
} from '../../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  createVideoComment as createVideoCommentCore,
} from './manage-video-comment.handler';

export const createVideoComment = onCall(
  { region: FUNCTIONS_REGION },
  async (request) => {
    const authorUid = String(request.auth?.uid ?? '').trim();

    if (authorUid) {
      await assertInteractionAccess(authorUid);
    }

    return createVideoCommentCore.run(request as any);
  }
);
