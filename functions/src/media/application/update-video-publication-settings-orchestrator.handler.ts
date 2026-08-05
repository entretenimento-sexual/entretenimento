import { onCall } from 'firebase-functions/v2/https';

import {
  assertAccountOperationalAccess,
} from '../../account_lifecycle/account-operational-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  updateVideoPublicationSettings as updateVideoPublicationSettingsCore,
} from './update-video-publication-settings.handler';

export const updateVideoPublicationSettings = onCall(
  { region: FUNCTIONS_REGION },
  async (request) => {
    const ownerUid = String(
      (request.data as { ownerUid?: unknown } | null | undefined)?.ownerUid ?? ''
    ).trim();
    const requesterUid = String(request.auth?.uid ?? '').trim();

    if (ownerUid && requesterUid === ownerUid) {
      await assertAccountOperationalAccess(
        ownerUid,
        'MEDIA_PUBLISH'
      );
    }

    return updateVideoPublicationSettingsCore.run(request as any);
  }
);
