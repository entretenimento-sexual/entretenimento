// functions/src/community/sync-community-user-index.trigger.ts
// -----------------------------------------------------------------------------
// SYNC COMMUNITY USER INDEX
// -----------------------------------------------------------------------------
// Mantém a projeção privada de “Minhas comunidades” a partir da fonte canônica:
// o membership. Entrada, aprovação, promoção, saída, bloqueio ou exclusão passam
// pelo mesmo ponto, evitando divergência entre handlers atuais e futuros.
// Eventos atrasados nunca recriam índice para Comunidade arquivada ou agendada
// para exclusão porque o estado canônico da Comunidade é relido antes do write.
// -----------------------------------------------------------------------------

import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import { buildCommunityUserIndexProjection } from './community-user-index.projection';

function isCommunityUserIndexTerminal(rawCommunity: unknown): boolean {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  return community['status'] === 'archived'
    || community['status'] === 'scheduled_for_deletion';
}

export const syncCommunityUserIndex = onDocumentWritten(
  {
    document: 'communities/{communityId}/members/{memberId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const communityId = String(event.params['communityId'] ?? '').trim();
    const memberId = String(event.params['memberId'] ?? '').trim();

    if (!communityId || !memberId) return;

    const indexRef = db
      .collection('community_user_index')
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

    if (!community || isCommunityUserIndexTerminal(community)) {
      await indexRef.delete();
      return;
    }

    const projection = buildCommunityUserIndexProjection(
      communityId,
      community,
      membershipSnapshot.data()
    );

    if (!projection) {
      await indexRef.delete();
      return;
    }

    await indexRef.set(
      {
        ...projection,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
);
