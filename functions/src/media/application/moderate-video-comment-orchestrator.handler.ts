import { onCall } from 'firebase-functions/v2/https';

import {
  assertAccountOperationalAccess,
} from '../../account_lifecycle/account-operational-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  moderateVideoComment as moderateVideoCommentCore,
} from './manage-video-comment.handler';

/**
 * Ocultar e excluir reduzem exposição e continuam disponíveis. Restaurar torna
 * conteúdo visível novamente e exige uma conta integralmente operacional.
 */
export const moderateVideoComment = onCall(
  { region: FUNCTIONS_REGION },
  async (request) => {
    const requesterUid = String(request.auth?.uid ?? '').trim();
    const action = String(
      (request.data as { action?: unknown } | null | undefined)?.action ?? ''
    ).trim().toUpperCase();

    if (requesterUid && action === 'RESTORE') {
      await assertAccountOperationalAccess(
        requesterUid,
        'MEDIA_MODERATE_OWN'
      );
    }

    return moderateVideoCommentCore.run(request as any);
  }
);
