import { onCall } from 'firebase-functions/v2/https';

import {
  assertInteractionAccess,
} from '../../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  createPhotoComment as createPhotoCommentCore,
} from './manage-photo-comment.handler';
import {
  REQUIRE_PUBLIC_MEDIA_APP_CHECK,
  assertPublicMediaCallableAppCheck,
} from './public-media-callable-security';
import {
  assertPublicMediaConsumptionAccess,
} from './public-media-consumption-access.policy';
import {
  consumePublicPhotoSocialInteractionQuota,
} from './public-photo-social-interaction-rate-limit.service';

export const createPhotoComment = onCall(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_PUBLIC_MEDIA_APP_CHECK,
  },
  async (request) => {
    assertPublicMediaCallableAppCheck(request.app);

    const authorUid = String(request.auth?.uid ?? '').trim();

    if (authorUid) {
      await consumePublicPhotoSocialInteractionQuota('comment', authorUid);
      await assertPublicMediaConsumptionAccess(authorUid);
      await assertInteractionAccess(authorUid);
    }

    return createPhotoCommentCore.run(request as any);
  }
);
