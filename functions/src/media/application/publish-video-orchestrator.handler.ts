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
  publishVideo as publishVideoCore,
} from './manage-video-publication.handler';
import {
  synchronizePublishedVideoSettings,
} from './sync-published-video-settings.handler';

const VIDEO_PUBLISH_RATE_LIMIT = Object.freeze({
  burstWindowMs: 60_000,
  burstMax: 12,
  sustainedWindowMs: 10 * 60_000,
  sustainedMax: 60,
});

interface PublishVideoResponse {
  videoId: string;
  moderationStatus: string;
  [key: string]: unknown;
}

function ownerUidFromRequestData(data: unknown): string {
  const ownerUid = String(
    (data as { ownerUid?: unknown } | null | undefined)?.ownerUid ?? ''
  ).trim();

  return /^[A-Za-z0-9_-]{1,128}$/.test(ownerUid) ? ownerUid : '';
}

/**
 * Publica o vídeo e só responde depois que a projeção pública recebeu os
 * metadados e preferências canônicos já salvos na publicação privada.
 */
export const publishVideo = onCall(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
  },
  async (request) => {
    assertCallableAppCheck(request.app);
    const ownerUid = ownerUidFromRequestData(request.data);
    const requesterUid = String(request.auth?.uid ?? '').trim();

    if (ownerUid && requesterUid === ownerUid) {
      await consumeBackendRateLimitQuota({
        action: 'video-publish',
        subject: requesterUid,
        config: VIDEO_PUBLISH_RATE_LIMIT,
        message: 'Muitas tentativas de publicação de vídeo foram feitas em pouco tempo.',
      });
      await assertInteractionAccess(ownerUid);
    }

    const response = (
      await publishVideoCore.run(request as any)
    ) as PublishVideoResponse;

    await synchronizePublishedVideoSettings(ownerUid, response.videoId);

    return response;
  }
);
