// functions/src/community/community-membership-eligibility.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBERSHIP ELIGIBILITY
// -----------------------------------------------------------------------------
// Centraliza a elegibilidade atual da conta para entrada e aprovação. O gate
// social canônico protege conta/termos/maioridade; membership acrescenta apenas
// o requisito específico de perfil concluído.
// -----------------------------------------------------------------------------

import { HttpsError } from 'firebase-functions/v2/https';

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
