// functions/src/community/sync-community-profile-membership-index.trigger.ts
// -----------------------------------------------------------------------------
// SYNC PRIVATE PROFILE-MEMBERSHIP LOCATOR
// -----------------------------------------------------------------------------
// O trigger acompanha toda mudança de membership, inclusive saída/bloqueio por
// outros handlers. O locator é somente uma dica de busca; o endpoint público
// revalida o documento canônico antes de expor qualquer card.
// -----------------------------------------------------------------------------

import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  buildCommunityProfileMembershipIndexProjection,
} from './community-profile-membership-index.projection';

export const syncCommunityProfileMembershipIndex = onDocumentWritten(
  {
    document: 'communities/{communityId}/members/{memberId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const communityId = String(event.params['communityId'] ?? '').trim();
    const memberId = String(event.params['memberId'] ?? '').trim();

    if (!communityId || !memberId) return;

    const indexRef = db
      .collection('community_profile_membership_index')
      .doc(memberId)
      .collection('items')
      .doc(communityId);
    const membershipSnapshot = event.data?.after;
    const projection = membershipSnapshot?.exists
      ? buildCommunityProfileMembershipIndexProjection(
        communityId,
        membershipSnapshot.data()
      )
      : null;

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
