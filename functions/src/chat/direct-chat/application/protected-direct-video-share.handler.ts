import { onCall } from 'firebase-functions/v2/https';

import { PROTECTED_CALLABLE_OPTIONS } from '../../../config/protected-callable-options';
import {
  assertMediaCallableRateLimit,
} from '../../../media/application/media-callable-rate-limit.service';
import {
  sendDirectVideoReference as sendDirectVideoReferenceCore,
} from './send-direct-video-reference.handler';

interface SendDirectVideoReferenceRequest {
  chatId?: unknown;
  publicVideoReference?: {
    ownerUid?: unknown;
    videoId?: unknown;
  } | null;
}

function cleanActorUid(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function keyPart(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return normalized
    ? normalized.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128)
    : 'invalid';
}

export const sendDirectVideoReference = onCall<
  SendDirectVideoReferenceRequest
>(
  {
    ...PROTECTED_CALLABLE_OPTIONS,
    invoker: 'public',
  },
  async (request) => {
    const actorUid = cleanActorUid(request.auth?.uid);

    if (actorUid) {
      await assertMediaCallableRateLimit({
        actorUid,
        action: 'SHARE_MESSAGE',
        resourceKey: [
          'direct',
          keyPart(request.data?.chatId),
          keyPart(request.data?.publicVideoReference?.ownerUid),
          keyPart(request.data?.publicVideoReference?.videoId),
        ].join(':'),
      });
    }

    return sendDirectVideoReferenceCore.run(request);
  }
);
