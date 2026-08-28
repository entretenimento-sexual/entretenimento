// -----------------------------------------------------------------------------
// GET COMMUNITY CREATION CAPABILITY
// -----------------------------------------------------------------------------
// Informa, antes de montar o compositor, se a conta pode criar uma Comunidade.
// O cliente nunca deriva autorização a partir do plano exibido no perfil.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  evaluatePlatformSubscriptionEntitlement,
} from '../payments/application/platform-subscription-entitlement.service';
import { isFunctionsEmulatorRuntime } from '../shared/runtime/functions-runtime.guard';
import {
  CommunityCreationCapability,
  MAX_PERSONAL_COMMUNITIES_PER_OWNER,
  resolveCommunityCapacitySponsorRole,
  resolveCommunityCreationCapability,
} from './community-capacity.policy';
import {
  assertCommunityCallableAppCheck,
  REQUIRE_COMMUNITY_APP_CHECK,
} from './community-callable-security';
import { assertCommunityMembershipActorEligible } from './community-membership-eligibility.service';

export interface CommunityCreationCapabilityResponse
  extends CommunityCreationCapability {
  generatedAt: number;
}

function assertPreviewRuntime(): void {
  if (isFunctionsEmulatorRuntime()) return;

  throw new HttpsError(
    'failed-precondition',
    'A criação de comunidades ainda não está disponível neste ambiente.'
  );
}

function assertAuthenticatedUid(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = String(auth?.uid ?? '').trim();

  if (!uid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  if (auth?.token?.['email_verified'] !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verifique seu e-mail para continuar.'
    );
  }

  return uid;
}

export const getCommunityCreationCapability = onCall(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityCreationCapabilityResponse> => {
    assertCommunityCallableAppCheck(request.app);
    assertPreviewRuntime();
    const actorUid = assertAuthenticatedUid(request.auth);
    const userRef = db.collection('users').doc(actorUid);
    const entitlementRef = db
      .collection('entitlements')
      .doc(`platform_subscription_${actorUid}`);
    const ownedCommunitiesQuery = db
      .collection('communities')
      .where('ownerUid', '==', actorUid)
      .where('source.type', '==', 'community')
      .where('status', 'in', ['active', 'paused', 'dormant'])
      .limit(MAX_PERSONAL_COMMUNITIES_PER_OWNER + 1);
    const [userSnapshot, entitlementSnapshot, ownedCommunitiesSnapshot] =
      await Promise.all([
        userRef.get(),
        entitlementRef.get(),
        ownedCommunitiesQuery.get(),
      ]);

    assertCommunityMembershipActorEligible(
      userSnapshot.exists ? userSnapshot.data() : null,
      actorUid
    );

    const actorUser = userSnapshot.data() ?? {};
    const entitlement = evaluatePlatformSubscriptionEntitlement(
      entitlementSnapshot.exists ? entitlementSnapshot.data() : null,
      actorUid
    );
    const sponsorRole = resolveCommunityCapacitySponsorRole(
      entitlement.active ? entitlement.role : null,
      actorUser['role']
    );

    return {
      ...resolveCommunityCreationCapability({
        sponsorRole,
        currentOwnedCommunities: ownedCommunitiesSnapshot.size,
      }),
      generatedAt: Date.now(),
    };
  }
);
