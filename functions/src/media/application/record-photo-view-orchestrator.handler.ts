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
import { assertPublicMediaConsumptionAccess } from './public-media-consumption-access.policy';
import {
  consumePublicPhotoViewRecordQuota,
} from './public-photo-view-record-rate-limit.service';
import {
  recordPhotoView as recordPhotoViewCore,
} from './record-photo-view.handler';

export const recordPhotoView = onCall(
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

    await consumePublicPhotoViewRecordQuota(viewerUid);
    await assertInteractionAccess(viewerUid);
    await assertPublicMediaConsumptionAccess(viewerUid);

    if (ownerUid && ownerUid !== viewerUid) {
      await assertNoActiveBilateralBlock(
        viewerUid,
        ownerUid,
        'Foto pública não encontrada.'
      );
    }

    return recordPhotoViewCore.run(request as any);
  }
);
