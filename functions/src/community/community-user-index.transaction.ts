// functions/src/community/community-user-index.transaction.ts
// -----------------------------------------------------------------------------
// COMMUNITY USER INDEX TRANSACTION
// -----------------------------------------------------------------------------
// Mantém "Minhas comunidades" consistente na mesma transação que altera a
// membership. O trigger de sincronização permanece como reconciliação/fallback.
// -----------------------------------------------------------------------------

import type { Transaction } from 'firebase-admin/firestore';

import { db, FieldValue } from '../firebaseApp';
import { buildCommunityUserIndexProjection } from './community-user-index.projection';

export interface CommunityUserIndexTransactionInput {
  readonly transaction: Transaction;
  readonly communityId: string;
  readonly memberId: string;
  readonly community: unknown;
  readonly membership: unknown;
  readonly updatedAt: ReturnType<typeof FieldValue.serverTimestamp>;
}

export function syncCommunityUserIndexInTransaction(
  input: CommunityUserIndexTransactionInput
): void {
  const indexRef = db
    .collection('community_user_index')
    .doc(input.memberId)
    .collection('items')
    .doc(input.communityId);

  const projection = buildCommunityUserIndexProjection(
    input.communityId,
    input.community,
    input.membership
  );

  if (!projection) {
    input.transaction.delete(indexRef);
    return;
  }

  input.transaction.set(indexRef, {
    ...projection,
    updatedAt: input.updatedAt,
  });
}
