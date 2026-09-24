// functions/src/community/sync-community-explore-content.trigger.ts
import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  buildCommunityExploreContentProjection,
  communityExploreContentSourceFingerprint,
} from './community-explore-content.model';

export const syncCommunityExploreContent = onDocumentWritten(
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
    const indexRef = db
      .collection('community_explore_content_index')
      .doc(`${communityId}:${postId}`);

    if (!after) {
      await indexRef.delete();
      return;
    }

    if (
      before
      && communityExploreContentSourceFingerprint(before)
        === communityExploreContentSourceFingerprint(after)
    ) {
      return;
    }

    const [discoverySnapshot, operationalSnapshot] = await Promise.all([
      db.collection('community_discovery_index').doc(communityId).get(),
      db
        .collection('community_feed_posts')
        .doc(communityId)
        .collection('items')
        .doc(postId)
        .get(),
    ]);

    const projection = buildCommunityExploreContentProjection({
      communityId,
      postId,
      discovery: discoverySnapshot.exists ? discoverySnapshot.data() : null,
      feed: after,
      operationalPost: operationalSnapshot.exists
        ? operationalSnapshot.data()
        : null,
    });

    if (!projection) {
      await indexRef.delete();
      return;
    }

    await indexRef.set(projection);
    logger.debug('community_explore_content_synced', {
      communityId,
      postId,
      kind: projection.post.kind,
      expiresAt: projection.expiresAt,
    });
  }
);
