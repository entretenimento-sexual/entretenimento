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
  recordVideoView as recordVideoViewCore,
} from './record-video-view.handler';
import {
  consumePublicVideoViewRecordQuota,
} from './public-video-view-record-rate-limit.service';

export const recordVideoView = onCall(
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

    await consumePublicVideoViewRecordQuota(viewerUid);
    await assertInteractionAccess(viewerUid);

    if (ownerUid && ownerUid !== viewerUid) {
      await assertNoActiveBilateralBlock(
        viewerUid,
        ownerUid,
        'Vídeo público não encontrado.'
      );
    }

    return recordVideoViewCore.run(request as any);
  }
);
