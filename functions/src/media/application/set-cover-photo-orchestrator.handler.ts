import { onCall } from 'firebase-functions/v2/https';

import {
  assertAccountOperationalAccess,
} from '../../account_lifecycle/account-operational-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  setCoverPhoto as setCoverPhotoCore,
} from './manage-photo-publication.handler';

export const setCoverPhoto = onCall(
  { region: FUNCTIONS_REGION },
  async (request) => {
    const ownerUid = String(
      (request.data as { ownerUid?: unknown } | null | undefined)?.ownerUid ?? ''
    ).trim();
    const requesterUid = String(request.auth?.uid ?? '').trim();

    if (ownerUid && requesterUid === ownerUid) {
      await assertAccountOperationalAccess(
        ownerUid,
        'MEDIA_PUBLISH'
      );
    }

    return setCoverPhotoCore.run(request as any);
  }
);
