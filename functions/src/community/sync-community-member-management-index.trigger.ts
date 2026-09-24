// functions/src/community/sync-community-member-management-index.trigger.ts
// -----------------------------------------------------------------------------
// SYNC COMMUNITY MEMBER MANAGEMENT INDEX
// -----------------------------------------------------------------------------
// Membership continua sendo a fonte canônica. Esta projeção existe somente
// para localizar membros por nome/papel sem varrer toda a Comunidade.
// -----------------------------------------------------------------------------

import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  buildCommunityMemberManagementIndexProjection,
  communityMemberManagementProjectionId,
} from './community-member-management-index.policy';

function communityCanExposeManagementIndex(rawCommunity: unknown): boolean {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const source = (community['source'] ?? {}) as Record<string, unknown>;

  return source['type'] === 'community'
    && (community['status'] === 'active' || community['status'] === 'paused');
}

export const syncCommunityMemberManagementIndex = onDocumentWritten(
  {
    document: 'communities/{communityId}/members/{memberId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const communityId = String(event.params['communityId'] ?? '').trim();
    const memberId = String(event.params['memberId'] ?? '').trim();

    if (!communityId || !memberId) return;

    const indexRef = db
      .collection('community_member_management_index')
      .doc(communityMemberManagementProjectionId(communityId, memberId));
    const membershipSnapshot = event.data?.after;

    if (!membershipSnapshot?.exists) {
      await indexRef.delete();
      return;
    }

    const [communitySnapshot, userSnapshot] = await Promise.all([
      db.collection('communities').doc(communityId).get(),
      db.collection('users').doc(memberId).get(),
    ]);
    const community = communitySnapshot.exists
      ? communitySnapshot.data() ?? null
      : null;

    if (!community || !communityCanExposeManagementIndex(community)) {
      await indexRef.delete();
      return;
    }

    const projection = buildCommunityMemberManagementIndexProjection({
      communityId,
      memberId,
      rawMembership: membershipSnapshot.data(),
      rawUser: userSnapshot.exists ? userSnapshot.data() : null,
    });

    if (!projection) {
      await indexRef.delete();
      return;
    }

    await indexRef.set({
      ...projection,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
);
