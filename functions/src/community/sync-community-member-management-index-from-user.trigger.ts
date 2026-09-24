// functions/src/community/sync-community-member-management-index-from-user.trigger.ts
// -----------------------------------------------------------------------------
// SYNC MANAGEMENT SEARCH IDENTITY FROM USER
// -----------------------------------------------------------------------------
// Alterações de nickname/avatar atualizam somente a identidade de busca dos
// índices já existentes. Membership, status e papel nunca são derivados daqui.
// -----------------------------------------------------------------------------

import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  buildCommunityMemberManagementSearchIdentity,
} from './community-member-management-index.policy';

export const syncCommunityMemberManagementIndexFromUser = onDocumentWritten(
  {
    document: 'users/{memberId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const memberId = String(event.params['memberId'] ?? '').trim();
    if (!memberId) return;

    const indexSnapshot = await db
      .collection('community_member_management_index')
      .where('memberId', '==', memberId)
      .get();

    if (indexSnapshot.empty) return;

    const identity = buildCommunityMemberManagementSearchIdentity(
      event.data?.after?.exists ? event.data.after.data() : null
    );
    const writer = db.bulkWriter();

    for (const document of indexSnapshot.docs) {
      const current = document.data() ?? {};
      const unchanged =
        current['label'] === identity.label
        && (current['avatarUrl'] ?? null) === identity.avatarUrl
        && current['sortLabel'] === identity.sortLabel
        && Array.isArray(current['searchPrefixes'])
        && current['searchPrefixes'].length === identity.searchPrefixes.length
        && current['searchPrefixes'].every(
          (value: unknown, index: number) =>
            value === identity.searchPrefixes[index]
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
