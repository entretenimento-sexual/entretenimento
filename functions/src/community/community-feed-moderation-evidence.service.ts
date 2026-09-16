import { db } from '../firebaseApp';
import {
  isBlockingCommunityFeedModerationReportStatus,
} from './community-feed-moderation-evidence.policy';

export async function hasBlockingCommunityFeedPostReportInTransaction(
  transaction: FirebaseFirestore.Transaction,
  communityId: string,
  postId: string,
  excludeReportId?: string
): Promise<boolean> {
  const snapshot = await transaction.get(
    db
      .collection('moderation_reports')
      .where('targetId', '==', postId)
      .where('targetType', '==', 'community_feed_post')
  );

  return snapshot.docs.some((doc) => {
    if (excludeReportId && doc.id === excludeReportId) return false;

    const report = doc.data() ?? {};
    if (String(report['parentTargetId'] ?? '').trim() !== communityId) {
      return false;
    }

    return isBlockingCommunityFeedModerationReportStatus(report['status']);
  });
}
