import { onCall } from 'firebase-functions/v2/https';

import {
  assertInteractionAccess,
} from '../../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  assertCallableAppCheck,
  REQUIRE_CALLABLE_APP_CHECK,
} from '../../shared/security/callable-app-check';
import {
  consumeBackendRateLimitQuota,
} from '../../shared/security/backend-rate-limit.service';
import {
  publishPhoto as publishPhotoCore,
} from './manage-photo-publication.handler';

const PHOTO_PUBLISH_RATE_LIMIT = Object.freeze({
  burstWindowMs: 60_000,
  burstMax: 12,
  sustainedWindowMs: 10 * 60_000,
  sustainedMax: 60,
});

export const publishPhoto = onCall(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
  },
  async (request) => {
    assertCallableAppCheck(request.app);
    const ownerUid = String(
      (request.data as { ownerUid?: unknown } | null | undefined)?.ownerUid ?? ''
    ).trim();
    const requesterUid = String(request.auth?.uid ?? '').trim();

    if (ownerUid && requesterUid === ownerUid) {
      await consumeBackendRateLimitQuota({
        action: 'photo-publish',
        subject: requesterUid,
        config: PHOTO_PUBLISH_RATE_LIMIT,
        message: 'Muitas tentativas de publicação de foto foram feitas em pouco tempo.',
      });
      await assertInteractionAccess(ownerUid);
    }

    return publishPhotoCore.run(request as any);
  }
);
