import { onCall } from 'firebase-functions/v2/https';

import {
  assertInteractionAccess,
} from '../../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  publishPhoto as publishPhotoCore,
} from './manage-photo-publication.handler';

export const publishPhoto = onCall(
  { region: FUNCTIONS_REGION },
  async (request) => {
    const ownerUid = String(
      (request.data as { ownerUid?: unknown } | null | undefined)?.ownerUid ?? ''
    ).trim();
    const requesterUid = String(request.auth?.uid ?? '').trim();

    if (ownerUid && requesterUid === ownerUid) {
      await assertInteractionAccess(ownerUid);
    }

    return publishPhotoCore.run(request as any);
  }
);
