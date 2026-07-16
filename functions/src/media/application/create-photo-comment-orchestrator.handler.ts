import { onCall } from 'firebase-functions/v2/https';

import {
  assertInteractionAccess,
} from '../../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  createPhotoComment as createPhotoCommentCore,
} from './manage-photo-comment.handler';

export const createPhotoComment = onCall(
  { region: FUNCTIONS_REGION },
  async (request) => {
    const authorUid = String(request.auth?.uid ?? '').trim();

    if (authorUid) {
      await assertInteractionAccess(authorUid);
    }

    return createPhotoCommentCore.run(request as any);
  }
);
