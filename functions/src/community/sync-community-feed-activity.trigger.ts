// functions/src/community/sync-community-feed-activity.trigger.ts
// -----------------------------------------------------------------------------
// SYNC COMMUNITY FEED ACTIVITY
// -----------------------------------------------------------------------------
// A projeção community_public_feed é backend-only. Novas publicações válidas e
// crescimento real de comentários/reações atualizam o relógio de lifecycle.
// Comunidades arquivadas ou agendadas para exclusão permanecem congeladas.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import { canSyncCommunityActivity } from './community-activity-sync.policy';
import { isCommunityFeedTransitionMeaningful } from './community-feed-activity.policy';

export const syncCommunityFeedActivity = onDocumentWritten(
  {
    document: 'community_public_feed/{communityId}/items/{itemId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const before = event.data?.before.exists
      ? event.data.before.data()
      : null;
    const after = event.data?.after.exists
      ? event.data.after.data()
      : null;

    if (!isCommunityFeedTransitionMeaningful(before, after)) return;

    const communityId = String(event.params['communityId'] ?? '').trim();
    if (!communityId) return;

    const communityRef = db.collection('communities').doc(communityId);
    const communitySnapshot = await communityRef.get();
    if (!communitySnapshot.exists) return;

    const community = communitySnapshot.data() ?? {};
    if (!canSyncCommunityActivity(community)) return;

    const now = FieldValue.serverTimestamp();
    await communityRef.update({
      'lifecycle.lastMeaningfulActivityAt': now,
      updatedAt: now,
    });

    logger.debug('community_feed_activity_synced', {
      communityId,
    });
  }
);
