// functions/src/community/sync-community-feed-realtime.trigger.ts
// -----------------------------------------------------------------------------
// SYNC COMMUNITY FEED REALTIME
// -----------------------------------------------------------------------------
// Espelha somente um evento mínimo e não sensível de cada publicação. O cliente
// usa esse documento como sinal incremental; conteúdo/capacidades continuam
// vindo de callable autorizada. Tombstones permitem remover itens legados que
// nunca haviam sido espelhados antes desta versão.
//
// Em Comunidades arquivadas, agendadas para exclusão ou já inexistentes, a
// remoção da projeção pública apaga o sinal realtime em vez de recriar tombstone.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { shouldDeleteCommunityFeedRealtimeProjection } from './community-feed-realtime-cleanup.policy';
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
    const realtimeRef = db
      .collection('community_feed_realtime')
      .doc(communityId)
      .collection('items')
      .doc(postId);

    if (!after) {
      const communitySnapshot = await db
        .collection('communities')
        .doc(communityId)
        .get();
      const community = communitySnapshot.exists
        ? communitySnapshot.data() ?? null
        : null;

      if (shouldDeleteCommunityFeedRealtimeProjection(false, community)) {
        await realtimeRef.delete();
        logger.debug('community_feed_realtime_deleted_for_terminal_state', {
          communityId,
          postId,
        });
        return;
      }
    }

    const projection = buildCommunityFeedRealtimeProjection(
      postId,
      before,
      after,
      Date.now()
    );

    if (!projection) return;

    await realtimeRef.set(projection);

    logger.debug('community_feed_realtime_synced', {
      communityId,
      postId,
      state: projection.state,
    });
  }
);
