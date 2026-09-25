// functions/src/community/sync-community-member-management-index-from-public-profile.trigger.ts
// -----------------------------------------------------------------------------
// SYNC PUBLIC MEMBER SEARCH IDENTITY
// -----------------------------------------------------------------------------
// A busca comum nunca reutiliza a identidade administrativa de users/{uid}.
// Somente nickname público alimenta os campos pesquisáveis expostos ao callable.
// -----------------------------------------------------------------------------

import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  buildCommunityMemberPublicSearchIdentity,
  communityMemberPublicSearchIdentityEquals,
} from './community-member-management-index.policy';

export const syncCommunityMemberManagementIndexFromPublicProfile =
  onDocumentWritten(
    {
      document: 'public_profiles/{memberId}',
      region: FUNCTIONS_REGION,
    },
    async (event) => {
      const memberId = String(event.params['memberId'] ?? '').trim();
      if (!memberId) return;

      const previousIdentity = buildCommunityMemberPublicSearchIdentity(
        event.data?.before?.exists ? event.data.before.data() : null
      );
      const identity = buildCommunityMemberPublicSearchIdentity(
        event.data?.after?.exists ? event.data.after.data() : null
      );

      if (
        communityMemberPublicSearchIdentityEquals(
          previousIdentity,
          identity
        )
      ) {
        return;
      }

      const indexSnapshot = await db
        .collection('community_member_management_index')
        .where('memberId', '==', memberId)
        .get();

      if (indexSnapshot.empty) return;

      const writer = db.bulkWriter();

      for (const document of indexSnapshot.docs) {
        const current = document.data() ?? {};
        const currentPrefixes = Array.isArray(current['publicSearchPrefixes'])
          ? current['publicSearchPrefixes']
          : [];
        const unchanged =
          current['publicSearchSortLabel'] === identity.publicSearchSortLabel
          && currentPrefixes.length === identity.publicSearchPrefixes.length
          && currentPrefixes.every(
            (value: unknown, index: number) =>
              value === identity.publicSearchPrefixes[index]
          );

        if (unchanged) continue;

        writer.set(
          document.ref,
          {
            ...identity,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      await writer.close();
    }
  );
