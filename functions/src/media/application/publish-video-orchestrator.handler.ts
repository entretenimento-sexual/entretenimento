import { onCall } from 'firebase-functions/v2/https';

import {
  assertInteractionAccess,
} from '../../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  publishVideo as publishVideoCore,
} from './manage-video-publication.handler';
import {
  synchronizePublishedVideoSettings,
} from './sync-published-video-settings.handler';

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
  { region: FUNCTIONS_REGION },
  async (request) => {
    const ownerUid = ownerUidFromRequestData(request.data);
    const requesterUid = String(request.auth?.uid ?? '').trim();

    if (ownerUid && requesterUid === ownerUid) {
      await assertInteractionAccess(ownerUid);
    }

    const response = (
      await publishVideoCore.run(request as any)
    ) as PublishVideoResponse;

    await synchronizePublishedVideoSettings(ownerUid, response.videoId);

    return response;
  }
);
