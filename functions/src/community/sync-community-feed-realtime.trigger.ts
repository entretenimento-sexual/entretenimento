// functions/src/community/sync-community-feed-realtime.trigger.ts
// -----------------------------------------------------------------------------
// SYNC COMMUNITY FEED REALTIME
// -----------------------------------------------------------------------------
// Espelha somente um evento mínimo e não sensível de cada publicação. O cliente
// usa esse documento como sinal incremental; conteúdo/capacidades continuam
// vindo de callable autorizada. Tombstones permitem remover itens legados que
// nunca haviam sido espelhados antes desta versão.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { buildCommunityFeedRealtimeProjection } from './community-feed-realtime.projection';

export const syncCommunityFeedRealtime = onDocumentWritten(
  {
    document: 'community_public_feed/{communityId}/items/{postId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const communityId = String(event.params['communityId'] ?? '').trim();
    const postId = String(event.params['postId'] ?? '').trim();
    if (!communityId || !postId) return;

    const before = event.data?.before.exists
      ? event.data.before.data()
      : null;
    const after = event.data?.after.exists
      ? event.data.after.data()
      : null;
    const projection = buildCommunityFeedRealtimeProjection(
      postId,
      before,
      after,
      Date.now()
    );

    if (!projection) return;

    await db
      .collection('community_feed_realtime')
      .doc(communityId)
      .collection('items')
      .doc(postId)
      .set(projection);

    logger.debug('community_feed_realtime_synced', {
      communityId,
      postId,
      state: projection.state,
    });
  }
);
