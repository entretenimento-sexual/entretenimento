// functions/src/community/community-membership-eligibility.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBERSHIP ELIGIBILITY
// -----------------------------------------------------------------------------
// Centraliza elegibilidade da conta e requisito de entitlement para entrada e
// aprovação. Nenhum handler deve promover um membership usando apenas uma
// validação histórica.
// -----------------------------------------------------------------------------

import { HttpsError } from 'firebase-functions/v2/https';

import {
  evaluatePlatformSubscriptionEntitlement,
  hasMinimumPlatformRole,
  isPlatformRole,
} from '../payments/application/platform-subscription-entitlement.service';

export type CommunityMembershipMinimumRole = 'basic' | 'premium' | 'vip';

export interface CommunityMembershipRequirement {
  minimumRole: CommunityMembershipMinimumRole;
  requiresEntitlement: boolean;
}

function isAdultEligible(user: Record<string, unknown>): boolean {
  const idade = user['idade'];
  const adultConsent = (user['adultConsent'] ?? {}) as Record<string, unknown>;
  const ageReverification = (user['ageReverification'] ?? {}) as Record<
    string,
    unknown
  >;
  const ageStatus = String(ageReverification['status'] ?? '')
    .trim()
    .toUpperCase();

  if (typeof idade === 'number' && idade < 18) return false;
  if (ageReverification['result'] === 'UNDERAGE') return false;
  if (
    ['REQUIRED', 'SUBMITTED', 'UNDER_REVIEW', 'REJECTED', 'EXPIRED']
      .includes(ageStatus)
  ) {
    return false;
  }
  if (adultConsent['accepted'] === false) return false;
  if (
    user['initialAdultConsentRequired'] === true
    && adultConsent['accepted'] !== true
  ) {
    return false;
  }

  return true;
}

export function assertCommunityMembershipActorEligible(
  rawUser: unknown,
  uid: string
): void {
  const user = (rawUser ?? {}) as Record<string, unknown>;

  if (user['uid'] !== uid) {
    throw new HttpsError('not-found', 'Perfil não localizado.', {
      reason: 'profile_incomplete',
      recommendedAction: 'complete_profile',
    });
  }

  const accountStatus = String(user['accountStatus'] ?? 'active')
    .trim()
    .toLowerCase();
  const restricted =
    accountStatus !== 'active'
    || user['suspended'] === true
    || user['interactionBlocked'] === true
    || user['accountLocked'] === true
    || user['loginAllowed'] === false;

  if (restricted) {
    throw new HttpsError(
      'permission-denied',
      'Sua conta não pode participar agora.',
      {
        reason: 'account_restricted',
        recommendedAction: 'review_account',
      }
    );
  }

  if (!isAdultEligible(user)) {
    throw new HttpsError(
      'failed-precondition',
      'Confirmação de acesso adulto necessária.',
      {
        reason: 'adult_access_required',
        recommendedAction: 'confirm_adult_access',
      }
    );
  }

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

export function resolveCommunityMembershipRequirement(
  rawCommunity: unknown
): CommunityMembershipRequirement {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const access = (community['access'] ?? {}) as Record<string, unknown>;
  const contentAccess = (access['contentAccess'] ?? {}) as Record<
    string,
    unknown
  >;
  const minimumRole = isPlatformRole(contentAccess['minimumRole'])
    ? contentAccess['minimumRole']
    : 'basic';

  return {
    minimumRole,
    requiresEntitlement:
      contentAccess['requiresActiveSubscription'] === true
      || isPlatformRole(contentAccess['minimumRole']),
  };
}

export function isCommunityMembershipEntitlementAllowed(
  rawEntitlement: unknown,
  uid: string,
  requirement: Readonly<CommunityMembershipRequirement>
): boolean {
  if (!requirement.requiresEntitlement) return true;

  const entitlement = evaluatePlatformSubscriptionEntitlement(
    rawEntitlement,
    uid
  );

  return entitlement.active
    && hasMinimumPlatformRole(entitlement.role, requirement.minimumRole);
}
