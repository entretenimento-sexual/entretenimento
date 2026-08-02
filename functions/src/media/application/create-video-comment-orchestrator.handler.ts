import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  assertInteractionAccess,
} from '../../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  createVideoComment as createVideoCommentCore,
} from './manage-video-comment.handler';

export const createVideoComment = onCall(
  { region: FUNCTIONS_REGION },
  async (request) => {
    const authorUid = String(request.auth?.uid ?? '').trim();
    const ownerUid = String(request.data?.ownerUid ?? '').trim();
    const parentCommentId = String(
      request.data?.parentCommentId ?? ''
    ).trim();

    if (authorUid) {
      await assertInteractionAccess(authorUid);
    }

    /**
     * O dono pode responder comentários existentes, mas não criar comentário
     * raiz no próprio vídeo. Isso preserva a conversa com visitantes sem permitir
     * que o publicador aumente artificialmente commentsCount e o score.
     */
    if (authorUid && ownerUid && authorUid === ownerUid && !parentCommentId) {
      throw new HttpsError(
        'failed-precondition',
        'Responda a um comentário existente para interagir no próprio vídeo.'
      );
    }

    return createVideoCommentCore.run(request as any);
  }
);
