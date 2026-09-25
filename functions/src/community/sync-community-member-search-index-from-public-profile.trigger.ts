// functions/src/community/sync-community-member-search-index-from-public-profile.trigger.ts
// -----------------------------------------------------------------------------
// SYNC MEMBER SEARCH IDENTITY FROM PUBLIC PROFILE
// -----------------------------------------------------------------------------
// Mudanças relevantes em public_profiles atualizam somente a projeção de busca
// dos memberships localizados. community_member_management_index é usado aqui
// apenas como locator backend; nenhum campo privado dele é copiado.
// -----------------------------------------------------------------------------

import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  buildCommunityMemberSearchIndexProjection,
  communityMemberSearchProjectionId,
  communityMemberSearchPublicProfileFingerprint,
} from './community-member-search-index.policy';

function communityCanExposeMemberSearch(rawCommunity: unknown): boolean {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const source = (community['source'] ?? {}) as Record<string, unknown>;

  return source['type'] === 'community'
    && (community['status'] === 'active' || community['status'] === 'paused');
}

export const syncCommunityMemberSearchIndexFromPublicProfile = onDocumentWritten(
  {
    document: 'public_profiles/{memberId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const memberId = String(event.params['memberId'] ?? '').trim();
    if (!memberId) return;

    const previousFingerprint = communityMemberSearchPublicProfileFingerprint(
      event.data?.before?.exists ? event.data.before.data() : null
    );
    const nextProfile = event.data?.after?.exists
      ? event.data.after.data() ?? null
      : null;
    const nextFingerprint = communityMemberSearchPublicProfileFingerprint(
      nextProfile
    );

    if (previousFingerprint === nextFingerprint) return;

    const locatorSnapshot = await db
      .collection('community_member_management_index')
      .where('memberId', '==', memberId)
      .get();

    if (locatorSnapshot.empty) return;

    const communityIds = Array.from(new Set(
      locatorSnapshot.docs
        .map((document) => String(document.data()?.['communityId'] ?? '').trim())
        .filter(Boolean)
    ));
    if (!communityIds.length) return;

    const [communitySnapshots, membershipSnapshots] = await Promise.all([
      db.getAll(
        ...communityIds.map((communityId) =>
          db.collection('communities').doc(communityId)
        )
      ),
      db.getAll(
        ...communityIds.map((communityId) =>
          db.collection('communities').doc(communityId).collection('members').doc(memberId)
        )
      ),
    ]);

    const writer = db.bulkWriter();

    communityIds.forEach((communityId, index) => {
      const communitySnapshot = communitySnapshots[index];
      const membershipSnapshot = membershipSnapshots[index];
      const indexRef = db
        .collection('community_member_search_index')
        .doc(communityMemberSearchProjectionId(communityId, memberId));

      if (
        !communitySnapshot?.exists
        || !membershipSnapshot?.exists
        || !communityCanExposeMemberSearch(communitySnapshot.data())
      ) {
        writer.delete(indexRef);
        return;
      }

      const projection = buildCommunityMemberSearchIndexProjection({
        communityId,
        memberId,
        rawMembership: membershipSnapshot.data(),
        rawPublicProfile: nextProfile,
      });

      if (!projection) {
        writer.delete(indexRef);
        return;
      }

      writer.set(
        indexRef,
        {
          ...projection,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    await writer.close();
  }
);
