// -----------------------------------------------------------------------------
// SYNC COMMUNITY HIGHLIGHT COMMUNITY LIFECYCLE
// -----------------------------------------------------------------------------
// Destaques só existem enquanto a Comunidade está operacional. Pausa, arquivo,
// moderação suspensa ou exclusão removem o singleton editorial sem tocar no
// conteúdo original.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { shouldClearCommunityHighlightForCommunityTransition } from './community-highlight.policy';

export const syncCommunityHighlightCommunity = onDocumentWritten(
  {
    document: 'communities/{communityId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const communityId = String(event.params['communityId'] ?? '').trim();
    if (!communityId) return;

    const afterExists = event.data?.after.exists === true;
    const after = afterExists ? event.data?.after.data() ?? {} : {};
    const moderation = (after['moderation'] ?? {}) as Record<string, unknown>;
    const shouldClear = shouldClearCommunityHighlightForCommunityTransition({
      afterExists,
      afterStatus: after['status'],
      afterModerationState: moderation['state'],
    });
    if (!shouldClear) return;

    const highlightRef = db.collection('community_highlights').doc(communityId);
    const snapshot = await highlightRef.get();
    if (!snapshot.exists) return;

    await highlightRef.delete();
    logger.info('community_highlight_lifecycle_cleared', { communityId });
  }
);
