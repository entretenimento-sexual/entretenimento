import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { assertInteractionAccess } from '../../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import { consumeBackendRateLimitQuota }
  from '../../shared/security/backend-rate-limit.service';

const LEGACY_VIDEO_NORMALIZE_RATE_LIMIT = Object.freeze({
  burstWindowMs: 60_000,
  burstMax: 12,
  sustainedWindowMs: 10 * 60_000,
  sustainedMax: 48,
});
import {
  assertCallableAppCheck,
  REQUIRE_CALLABLE_APP_CHECK,
} from '../../shared/security/callable-app-check';

/**
 * Compatibility endpoint for older clients. Owner-authorized normalization
 * must not convert PENDING_REVIEW into APPROVED: only moderation may release
 * quarantine. Keep the callable response shape without any writes.
 */
export const normalizeLegacyVideoModeration = onCall<{
  ownerUid?: string;
  videoIds?: unknown[];
}>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
  },
  async (request) => {
    assertCallableAppCheck(request.app);
    const requesterUid = String(request.auth?.uid ?? '').trim();
    const ownerUid = String(request.data?.ownerUid ?? '').trim();
    if (!requesterUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(ownerUid) ||
        requesterUid !== ownerUid) {
      throw new HttpsError(
        'permission-denied',
        'Você só pode consultar vídeos do seu próprio perfil.'
      );
    }
    const videoCount = Array.isArray(request.data?.videoIds)
      ? Math.min(24, request.data.videoIds.length)
      : 0;
    if (videoCount === 0) {
      return { normalizedVideoIds: [] as string[] };
    }
    await consumeBackendRateLimitQuota({
      action: 'legacy-video-moderation-normalize',
      subject: requesterUid,
      cost: Math.max(1, Math.ceil(videoCount / 8)),
      config: LEGACY_VIDEO_NORMALIZE_RATE_LIMIT,
      message: 'Muitos vídeos antigos foram solicitados para normalização.',
    });
    await assertInteractionAccess(ownerUid);
    return { normalizedVideoIds: [] as string[] };
  }
);
