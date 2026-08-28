import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  assertInteractionAccess,
} from '../../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  assertNoActiveBilateralBlock,
} from '../../friendship/application/bilateral-block-access.policy';
import {
  assertPublicMediaCallableAppCheck,
  REQUIRE_PUBLIC_MEDIA_APP_CHECK,
} from './public-media-callable-security';
import {
  consumePublicVideoRetentionQuota,
} from './public-video-retention-rate-limit.service';
import {
  recordVideoRetention as recordVideoRetentionCore,
} from './record-video-retention.handler';

export const recordVideoRetention = onCall(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_PUBLIC_MEDIA_APP_CHECK,
  },
  async (request) => {
    const viewerUid = String(request.auth?.uid ?? '').trim();
    const ownerUid = String(request.data?.ownerUid ?? '').trim();

    assertPublicMediaCallableAppCheck(request.app);

    if (!viewerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    await consumePublicVideoRetentionQuota(viewerUid);
    await assertInteractionAccess(viewerUid);

    if (ownerUid && ownerUid !== viewerUid) {
      await assertNoActiveBilateralBlock(
        viewerUid,
        ownerUid,
        'Vídeo público não encontrado.'
      );
    }

    return recordVideoRetentionCore.run(request as any);
  }
);
