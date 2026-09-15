// functions/src/community/sync-community-profile-membership-index.trigger.ts
// -----------------------------------------------------------------------------
// SYNC PRIVATE PROFILE-MEMBERSHIP LOCATOR
// -----------------------------------------------------------------------------
// O trigger acompanha toda mudança de membership, inclusive saída/bloqueio por
// outros handlers. O locator é somente uma dica de busca; o endpoint público
// revalida o documento canônico antes de expor qualquer card.
// Eventos atrasados não podem recriar locator quando a Comunidade já está
// arquivada, scheduled_for_deletion ou inexistente.
// -----------------------------------------------------------------------------

import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  buildCommunityProfileMembershipIndexProjection,
} from './community-profile-membership-index.projection';

function isCommunityProfileIndexTerminal(rawCommunity: unknown): boolean {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  return community['status'] === 'archived'
    || community['status'] === 'scheduled_for_deletion';
}

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

    if (!membershipSnapshot?.exists) {
      await indexRef.delete();
      return;
    }

    const communitySnapshot = await db
      .collection('communities')
      .doc(communityId)
      .get();
    const community = communitySnapshot.exists
      ? communitySnapshot.data() ?? null
      : null;

    if (!community || isCommunityProfileIndexTerminal(community)) {
      await indexRef.delete();
      return;
    }

    const projection = buildCommunityProfileMembershipIndexProjection(
      communityId,
      membershipSnapshot.data()
    );

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
