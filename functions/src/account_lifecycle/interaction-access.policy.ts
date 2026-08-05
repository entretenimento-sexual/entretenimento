import type { Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  assertAccountOperationalAccess,
  assertAccountOperationalAccessData,
  assertAccountOperationalAccessInTransaction,
  type AccountOperationalUserDocument,
} from './account-operational-access.policy';

const INTERACTION_OPTIONS = {
  requireVerifiedEmail: false,
  requireCompletedProfile: false,
  requireAdultAccess: true,
  requireAcceptedTerms: false,
} as const;

/**
 * Nome preservado por compatibilidade com os handlers existentes.
 * A decisão agora delega para a policy canônica de conta operacional.
 */
export function assertInteractionAccessData(
  user: AccountOperationalUserDocument | null | undefined
): void {
  if (!user) {
    throw new HttpsError('not-found', 'Conta não encontrada.');
  }

  const documentUid = String(user.uid ?? 'legacy-account').trim();

  assertAccountOperationalAccessData(
    user,
    documentUid,
    'MEDIA_INTERACT',
    {},
    {
      ...INTERACTION_OPTIONS,
      allowMissingDocumentUid: true,
    }
  );
}

export async function assertInteractionAccess(uid: string): Promise<void> {
  await assertAccountOperationalAccess(
    uid,
    'MEDIA_INTERACT',
    INTERACTION_OPTIONS
  );
}

export async function assertInteractionAccessInTransaction(
  transaction: Transaction,
  uid: string
): Promise<void> {
  await assertAccountOperationalAccessInTransaction(
    transaction,
    uid,
    'MEDIA_INTERACT',
    {},
    INTERACTION_OPTIONS
  );
}
