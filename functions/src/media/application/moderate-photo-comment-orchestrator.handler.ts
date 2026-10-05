import { onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  consumeBackendRateLimitQuota,
} from '../../shared/security/backend-rate-limit.service';
import {
  moderatePhotoComment as moderatePhotoCommentCore,
} from './manage-photo-comment.handler';
import {
  REQUIRE_PUBLIC_MEDIA_APP_CHECK,
  assertPublicMediaCallableAppCheck,
} from './public-media-callable-security';

const PHOTO_COMMENT_MODERATION_RATE_LIMIT = Object.freeze({
  burstWindowMs: 60_000,
  burstMax: 30,
  sustainedWindowMs: 10 * 60_000,
  sustainedMax: 120,
});

export const moderatePhotoComment = onCall(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_PUBLIC_MEDIA_APP_CHECK,
  },
  async (request) => {
    assertPublicMediaCallableAppCheck(request.app);

    const requesterUid = String(request.auth?.uid ?? '').trim();
    if (requesterUid) {
      await consumeBackendRateLimitQuota({
        action: 'photo-comment-moderation',
        subject: requesterUid,
        config: PHOTO_COMMENT_MODERATION_RATE_LIMIT,
        message: 'Muitas alterações de comentários foram solicitadas em pouco tempo.',
      });
    }

    return moderatePhotoCommentCore.run(request as any);
  }
);
