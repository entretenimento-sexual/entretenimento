// functions/src/community/sync-community-user-index.trigger.ts
// -----------------------------------------------------------------------------
// SYNC COMMUNITY USER INDEX
// -----------------------------------------------------------------------------
// Mantém a projeção privada de “Minhas comunidades” a partir da fonte canônica:
// o membership. Entrada, aprovação, promoção, saída, bloqueio ou exclusão passam
// pelo mesmo ponto, evitando divergência entre handlers atuais e futuros.
// -----------------------------------------------------------------------------

import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import { buildCommunityUserIndexProjection } from './community-user-index.projection';

export const syncCommunityUserIndex = onDocumentWritten(
  {
    document: 'communities/{communityId}/members/{memberId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const communityId = String(event.params['communityId'] ?? '').trim();
    const memberId = String(event.params['memberId'] ?? '').trim();

    if (!communityId || !memberId) return;

    const communityRef = db.collection('communities').doc(communityId);
    const membershipRef = communityRef.collection('members').doc(memberId);
    const indexRef = db
      .collection('community_user_index')
      .doc(memberId)
      .collection('items')
      .doc(communityId);

    await db.runTransaction(async (transaction) => {
      const [communitySnapshot, membershipSnapshot] = await Promise.all([
        transaction.get(communityRef),
        transaction.get(membershipRef),
      ]);
      const projection = buildCommunityUserIndexProjection(
        communityId,
        communitySnapshot.exists ? communitySnapshot.data() : null,
        membershipSnapshot.exists ? membershipSnapshot.data() : null
      );

      if (!projection) {
        transaction.delete(indexRef);
        return;
      }

      transaction.set(
        indexRef,
        {
          ...projection,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });
  }
);
