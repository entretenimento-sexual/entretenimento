// functions/src/community/cleanup-community-feed-action-pointers-on-delete.trigger.ts
// -----------------------------------------------------------------------------
// CLEANUP COMMUNITY FEED ADMIN ACTION POINTERS ON CANONICAL DELETE
// -----------------------------------------------------------------------------
// O purge principal deriva ponteiros de `community_feed_audit`. Remoções antigas
// realizadas pela revisão administrativa de denúncias não gravavam essa trilha,
// embora criassem `community_feed_user_actions`. Como `moderation_reports` é
// preservado como evidência operacional, este trigger usa a exclusão canônica da
// Comunidade como último ponto seguro para limpar também esses ponteiros legados.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { onDocumentDeleted } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { resolveCommunityFeedActionPointerFromModerationReport } from './community-purge-action-pointer.policy';

const PAGE_SIZE = 200;

export const cleanupCommunityFeedActionPointersOnDelete = onDocumentDeleted(
  {
    document: 'communities/{communityId}',
    region: FUNCTIONS_REGION,
    retry: true,
    timeoutSeconds: 300,
  },
  async (event) => {
    const communityId = String(event.params['communityId'] ?? '').trim();
    if (!communityId) return;

    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    const deletedPaths = new Set<string>();
    let reportsProcessed = 0;
    let pointersDeleted = 0;

    while (true) {
      let query = db
        .collection('moderation_reports')
        .where('parentTargetId', '==', communityId)
        .limit(PAGE_SIZE);

      if (cursor) query = query.startAfter(cursor);

      const snapshot = await query.get();
      if (snapshot.empty) break;

      const refs = snapshot.docs.flatMap((report) => {
        reportsProcessed += 1;
        const target = resolveCommunityFeedActionPointerFromModerationReport(
          report.data(),
          communityId
        );
        if (!target) return [];

        const ref = db
          .collection('community_feed_user_actions')
          .doc(target.actorUid)
          .collection('items')
          .doc(`${communityId}:${target.postId}`);

        if (deletedPaths.has(ref.path)) return [];
        deletedPaths.add(ref.path);
        return [ref];
      });

      for (let offset = 0; offset < refs.length; offset += PAGE_SIZE) {
        const batch = db.batch();
        const page = refs.slice(offset, offset + PAGE_SIZE);
        page.forEach((ref) => batch.delete(ref));
        await batch.commit();
        pointersDeleted += page.length;
      }

      cursor = snapshot.docs[snapshot.docs.length - 1] ?? null;
      if (snapshot.size < PAGE_SIZE || !cursor) break;
    }

    logger.info('community_feed_admin_action_pointers_cleaned', {
      communityId,
      reportsProcessed,
      pointersDeleted,
    });
  }
);
