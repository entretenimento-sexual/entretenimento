// functions/src/community/community-social-access.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY SOCIAL ACCESS ELIGIBILITY
// -----------------------------------------------------------------------------
// Comunidades consomem a fronteira global de interação adulta. Nenhuma decisão
// etária nasce neste domínio.
// -----------------------------------------------------------------------------

import { HttpsError } from 'firebase-functions/v2/https';

import {
  assertInteractionAccessData,
} from '../account_lifecycle/interaction-access.policy';
import { db } from '../firebaseApp';

export function assertCommunitySocialAccessEligible(
  rawUser: unknown,
  uid: string,
  rawAgeEligibility: unknown
): void {
  const user = (rawUser ?? {}) as Record<string, unknown>;

  if (user['uid'] !== uid) {
    throw new HttpsError('not-found', 'Perfil não localizado.', {
      reason: 'profile_incomplete',
      recommendedAction: 'complete_profile',
    });
  }

  assertInteractionAccessData(
    user,
    rawAgeEligibility,
    uid
  );

  if (
    user['accountLocked'] === true ||
    user['loginAllowed'] === false
  ) {
    throw new HttpsError(
      'permission-denied',
      'Sua conta não pode acessar recursos sociais agora.',
      {
        reason: 'account_restricted',
        recommendedAction: 'review_account',
      }
    );
  }
}

export async function assertCommunitySocialAccessForUid(
  uid: string
): Promise<void> {
  const normalizedUid = String(uid ?? '').trim();
  if (!normalizedUid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  const [userSnapshot, ageEligibilitySnapshot] = await Promise.all([
    db.collection('users').doc(normalizedUid).get(),
    db.collection('age_eligibility_records').doc(normalizedUid).get(),
  ]);

  assertCommunitySocialAccessEligible(
    userSnapshot.exists ? userSnapshot.data() : null,
    normalizedUid,
    ageEligibilitySnapshot.exists ? ageEligibilitySnapshot.data() : null
  );
}
