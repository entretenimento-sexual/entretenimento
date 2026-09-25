// functions/src/community/sync-community-member-search-index.trigger.ts
// -----------------------------------------------------------------------------
// SYNC COMMUNITY MEMBER SEARCH INDEX
// -----------------------------------------------------------------------------
// Membership continua canônica. A projeção de busca usa apenas public_profiles
// e existe exclusivamente para localizar candidatos por nickname público.
// -----------------------------------------------------------------------------

import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  buildCommunityMemberSearchIndexProjection,
  communityMemberSearchProjectionId,
} from './community-member-search-index.policy';

function communityCanExposeMemberSearch(rawCommunity: unknown): boolean {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const source = (community['source'] ?? {}) as Record<string, unknown>;

  return source['type'] === 'community'
    && (community['status'] === 'active' || community['status'] === 'paused');
}

export const syncCommunityMemberSearchIndex = onDocumentWritten(
  {
    document: 'communities/{communityId}/members/{memberId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const communityId = String(event.params['communityId'] ?? '').trim();
    const memberId = String(event.params['memberId'] ?? '').trim();
    if (!communityId || !memberId) return;

    const indexRef = db
      .collection('community_member_search_index')
      .doc(communityMemberSearchProjectionId(communityId, memberId));
    const membershipSnapshot = event.data?.after;

    if (!membershipSnapshot?.exists) {
      await indexRef.delete();
      return;
    }

    const [communitySnapshot, profileSnapshot] = await Promise.all([
      db.collection('communities').doc(communityId).get(),
      db.collection('public_profiles').doc(memberId).get(),
    ]);
    const community = communitySnapshot.exists
      ? communitySnapshot.data() ?? null
      : null;

    if (!community || !communityCanExposeMemberSearch(community)) {
      await indexRef.delete();
      return;
    }

    const projection = buildCommunityMemberSearchIndexProjection({
      communityId,
      memberId,
      rawMembership: membershipSnapshot.data(),
      rawPublicProfile: profileSnapshot.exists ? profileSnapshot.data() : null,
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
