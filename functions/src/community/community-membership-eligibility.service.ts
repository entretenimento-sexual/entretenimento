// functions/src/community/community-membership-eligibility.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBERSHIP ELIGIBILITY
// -----------------------------------------------------------------------------
// Centraliza a elegibilidade atual da conta para entrada e aprovação. O gate
// social canônico protege lifecycle/termos/consentimento; membership acrescenta
// apenas o requisito específico de perfil concluído.
// -----------------------------------------------------------------------------

import type { Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { db } from '../firebaseApp';
import {
  assertCommunitySocialAccessEligible,
} from './community-social-access.service';

export function assertCommunityMembershipActorEligible(
  rawUser: unknown,
  uid: string
): void {
  assertCommunitySocialAccessEligible(rawUser, uid);

  const user = (rawUser ?? {}) as Record<string, unknown>;
  if (user['profileCompleted'] !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Complete seu perfil para continuar.',
      {
        reason: 'profile_incomplete',
        recommendedAction: 'complete_profile',
      }
    );
  }
}


export async function assertCommunityMembershipActorEligibleForUid(
  uid: string
): Promise<Record<string, unknown>> {
  const normalizedUid = String(uid ?? '').trim();
  if (!normalizedUid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  const userSnapshot = await db.collection('users').doc(normalizedUid).get();
  const user = userSnapshot.exists ? userSnapshot.data() ?? {} : null;

  assertCommunityMembershipActorEligible(
    user,
    normalizedUid
  );

  return (user ?? {}) as Record<string, unknown>;
}

export async function assertCommunityMembershipActorEligibleInTransaction(
  transaction: Transaction,
  uid: string,
  rawUser: unknown
): Promise<void> {
  const normalizedUid = String(uid ?? '').trim();
  if (!normalizedUid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  void transaction;

  assertCommunityMembershipActorEligible(
    rawUser,
    normalizedUid
  );
}
