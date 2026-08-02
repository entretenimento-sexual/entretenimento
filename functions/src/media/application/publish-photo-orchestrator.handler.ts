import { onCall } from 'firebase-functions/v2/https';

import {
  assertInteractionAccess,
} from '../../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  publishPhoto as publishPhotoCore,
} from './manage-photo-publication.handler';

interface PublishPhotoRequest {
  ownerUid?: string;
  photoId?: string;
  visibility?: 'FRIENDS' | 'SUBSCRIBERS' | 'PREMIUM' | 'PUBLIC';
  caption?: string | null;
  isCover?: boolean;
  orderIndex?: number;
  commentsEnabled?: boolean;
  commentsPolicy?: 'OFF' | 'FRIENDS' | 'SUBSCRIBERS' | 'EVERYONE';
  reactionsEnabled?: boolean;
}

export const publishPhoto = onCall<PublishPhotoRequest>(
  { region: FUNCTIONS_REGION },
  async (request) => {
    const ownerUid = String(request.data?.ownerUid ?? '').trim();
    const requesterUid = String(request.auth?.uid ?? '').trim();

    if (ownerUid && requesterUid === ownerUid) {
      await assertInteractionAccess(ownerUid);
    }

    return publishPhotoCore.run(request);
  }
);
