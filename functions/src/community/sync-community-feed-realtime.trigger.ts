// functions/src/community/sync-community-feed-realtime.trigger.ts
// -----------------------------------------------------------------------------
// SYNC COMMUNITY FEED REALTIME
// -----------------------------------------------------------------------------
// Espelha somente um evento mínimo e não sensível de cada publicação. O cliente
// usa esse documento como sinal incremental; conteúdo/capacidades continuam
// vindo de callable autorizada. Tombstones permitem remover itens legados que
// nunca haviam sido espelhados antes desta versão.
//
// Durante purge físico não recriamos tombstones: a projeção realtime é removida
// e o documento canônico da Comunidade continua existindo até a limpeza terminar.
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

    const realtimeRef = db
      .collection('community_feed_realtime')
      .doc(communityId)
      .collection('items')
      .doc(postId);
    const before = event.data?.before.exists
      ? event.data.before.data()
      : null;
    const after = event.data?.after.exists
      ? event.data.after.data()
      : null;

    if (!after) {
      const communitySnapshot = await db
        .collection('communities')
        .doc(communityId)
        .get();
      const status = communitySnapshot.exists
        ? String(communitySnapshot.data()?.['status'] ?? '').trim()
        : '';

      if (!communitySnapshot.exists || status === 'scheduled_for_deletion') {
        await realtimeRef.delete();
        logger.debug('community_feed_realtime_purge_delete', {
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
