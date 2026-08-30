// -----------------------------------------------------------------------------
// SYNC COMMUNITY HIGHLIGHT TARGET
// -----------------------------------------------------------------------------
// Evita destaque órfão: se a publicação fixada for removida, excluída ou deixar
// de estar ativa, o singleton editorial da Comunidade é apagado. A transação
// revalida o alvo para não remover um destaque que tenha sido trocado depois do
// evento que disparou o trigger.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { shouldClearCommunityHighlightForPostTransition } from './community-highlight.policy';

export const syncCommunityHighlightTarget = onDocumentWritten(
  {
    document: 'community_feed_posts/{communityId}/items/{postId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const communityId = String(event.params['communityId'] ?? '').trim();
    const postId = String(event.params['postId'] ?? '').trim();
    if (!communityId || !postId) return;

    const afterExists = event.data?.after.exists === true;
    const after = afterExists ? event.data?.after.data() ?? {} : {};
    if (
      afterExists
      && after['status'] === 'active'
      && after['moderationState'] === 'active'
    ) {
      return;
    }

    const highlightRef = db.collection('community_highlights').doc(communityId);
    const cleared = await db.runTransaction(async (transaction) => {
      const highlightSnapshot = await transaction.get(highlightRef);
      if (!highlightSnapshot.exists) return false;

      const highlight = highlightSnapshot.data() ?? {};
      const shouldClear = shouldClearCommunityHighlightForPostTransition({
        highlightedTargetType: highlight['targetType'],
        highlightedTargetId: highlight['targetId'],
        postId,
        afterExists,
        afterStatus: after['status'],
        afterModerationState: after['moderationState'],
      });
      if (!shouldClear) return false;

      transaction.delete(highlightRef);
      return true;
    });

    if (cleared) {
      logger.info('community_highlight_target_cleared', {
        communityId,
        postId,
      });
    }
  }
);
