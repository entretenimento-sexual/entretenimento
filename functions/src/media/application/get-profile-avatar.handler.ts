import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { getDefaultStorageBucket } from '../../firebaseApp';
import { resolveBlockedTargetUids } from '../../friendship/application/bilateral-block-access.policy';
import { AVATAR_IMAGE_MAX_BYTES } from '../media-format.generated';
import { consumeBackendRateLimitQuota } from './backend-rate-limit.service';
import { PUBLIC_MEDIA_ACCESS_RATE_LIMIT_CONFIG } from './public-media-rate-limit.config';
import { encodeProfileAvatar } from './finalize-profile-avatar.handler';
import {
  assertPublicMediaCallableAppCheck,
  REQUIRE_PUBLIC_MEDIA_APP_CHECK,
} from './public-media-callable-security';
import { assertPublicMediaConsumptionAccess } from './public-media-consumption-access.policy';
import { resolvePublicMediaOwnerExposure } from './public-media-owner-exposure.service';

const PUBLISHED_AVATAR_PATH =
  /^users\/([A-Za-z0-9_-]{1,128})\/published\/avatar\/(avatar-[A-Za-z0-9-]{1,128}\.(?:jpe?g|png|webp))$/;
const NEW_AVATAR_NAME = /^avatar-media-[0-9]+-[A-Za-z0-9-]+\.webp$/;

function unavailable(): HttpsError {
  return new HttpsError('not-found', 'Foto de perfil indisponível.');
}

export const getProfileAvatar = onCall<{ storagePath?: string }>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_PUBLIC_MEDIA_APP_CHECK,
  },
  async (request): Promise<{ image: string }> => {
    assertPublicMediaCallableAppCheck(request.app);
    const viewerUid = request.auth?.uid;
    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Entre na sua conta para ver a foto.');
    }

    const storagePath = request.data?.storagePath;
    const path = typeof storagePath === 'string' ? PUBLISHED_AVATAR_PATH.exec(storagePath) : null;
    if (!storagePath || !path) throw unavailable();
    const [, ownerUid, fileName] = path;

    if (viewerUid !== ownerUid) {
      await assertPublicMediaConsumptionAccess(viewerUid);
      const blocked = await resolveBlockedTargetUids(viewerUid, [ownerUid]);
      const exposure = await resolvePublicMediaOwnerExposure([ownerUid], blocked, Date.now());
      if (!exposure.get(ownerUid)?.allowed) throw unavailable();
    }

    await consumeBackendRateLimitQuota({
      action: 'profile-avatar-read',
      subject: viewerUid,
      cost: 1,
      config: PUBLIC_MEDIA_ACCESS_RATE_LIMIT_CONFIG,
      message: 'Muitas fotos de perfil foram solicitadas em pouco tempo.',
    });
    const file = getDefaultStorageBucket().file(storagePath);
    try {
      const currentFormat = NEW_AVATAR_NAME.test(fileName);
      const maximum = currentFormat ? 1024 * 1024 : AVATAR_IMAGE_MAX_BYTES;
      const [bytes] = await file.download({ end: maximum });
      if (!bytes.length || bytes.length > maximum) throw unavailable();
      const image = currentFormat ? bytes : await encodeProfileAvatar(bytes);
      return { image: image.toString('base64') };
    } catch (error) {
      if (Number((error as { code?: unknown } | null)?.code) === 404) {
        throw unavailable();
      }
      throw error;
    }
  }
);
