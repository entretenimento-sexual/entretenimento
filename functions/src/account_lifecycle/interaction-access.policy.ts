import type { Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { db } from '../firebaseApp';

interface InteractionAccessUserDocument {
  accountStatus?: unknown;
  suspended?: unknown;
  interactionBlocked?: unknown;
  ageReverification?: {
    status?: unknown;
  } | null;
}

export function assertInteractionAccessData(
  user: InteractionAccessUserDocument | null | undefined
): void {
  if (!user) {
    throw new HttpsError('not-found', 'Conta não encontrada.');
  }

  const accountStatus = String(user.accountStatus ?? 'active')
    .trim()
    .toLowerCase();
  const ageStatus = String(user.ageReverification?.status ?? '')
    .trim()
    .toUpperCase();
  const ageRestricted = ageStatus === 'REQUIRED' ||
    ageStatus === 'SUBMITTED' ||
    ageStatus === 'UNDER_REVIEW' ||
    ageStatus === 'EXPIRED';

  if (
    accountStatus !== 'active' ||
    user.suspended === true ||
    user.interactionBlocked === true ||
    ageRestricted
  ) {
    throw new HttpsError(
      'failed-precondition',
      ageRestricted
        ? 'Conclua a revalidação de idade antes de realizar esta ação.'
        : 'Esta conta não pode realizar interações no momento.'
    );
  }
}

export async function assertInteractionAccess(
  uid: string
): Promise<void> {
  const userSnapshot = await db.collection('users').doc(uid).get();
  assertInteractionAccessData(
    userSnapshot.exists
      ? userSnapshot.data() as InteractionAccessUserDocument
      : null
  );
}

export async function assertInteractionAccessInTransaction(
  transaction: Transaction,
  uid: string
): Promise<void> {
  const userSnapshot = await transaction.get(
    db.collection('users').doc(uid)
  );

  assertInteractionAccessData(
    userSnapshot.exists
      ? userSnapshot.data() as InteractionAccessUserDocument
      : null
  );
}
