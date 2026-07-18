// functions/src/community/community-membership-request.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBERSHIP REQUEST POLICY
// -----------------------------------------------------------------------------
// Decide a transição sem acessar Firebase. A callable continua responsável por
// autenticação, perfil, entitlement, transação, métricas e auditoria.
// -----------------------------------------------------------------------------

export type CommunityJoinPolicy = 'open' | 'approval' | 'invite_only';
export type CommunityMembershipStatus = 'active' | 'pending' | 'blocked' | 'left';
export type CommunityMembershipTargetStatus = 'active' | 'pending';

export type CommunityMembershipDenialReason =
  | 'community_unavailable'
  | 'invite_only'
  | 'membership_blocked'
  | 'actor_restricted'
  | 'subscription_required';

export interface CommunityMembershipRequestInput {
  operational: boolean;
  publicPreview: boolean;
  join: CommunityJoinPolicy;
  existingStatus: CommunityMembershipStatus | null;
  actorEligible: boolean;
  entitlementAllowed: boolean;
}

export interface CommunityMembershipRequestDecision {
  allowed: boolean;
  targetStatus: CommunityMembershipTargetStatus | null;
  denialReason: CommunityMembershipDenialReason | null;
  idempotent: boolean;
  incrementMemberCount: boolean;
}

function denied(
  denialReason: CommunityMembershipDenialReason
): CommunityMembershipRequestDecision {
  return {
    allowed: false,
    targetStatus: null,
    denialReason,
    idempotent: false,
    incrementMemberCount: false,
  };
}

export function evaluateCommunityMembershipRequest(
  input: Readonly<CommunityMembershipRequestInput>
): Readonly<CommunityMembershipRequestDecision> {
  if (input.existingStatus === 'blocked') {
    return denied('membership_blocked');
  }

  if (
    (input.existingStatus === 'active' || input.existingStatus === 'pending')
    && !input.entitlementAllowed
  ) {
    return denied('subscription_required');
  }

  if (input.existingStatus === 'active') {
    return {
      allowed: true,
      targetStatus: 'active',
      denialReason: null,
      idempotent: true,
      incrementMemberCount: false,
    };
  }

  if (input.existingStatus === 'pending') {
    return {
      allowed: true,
      targetStatus: 'pending',
      denialReason: null,
      idempotent: true,
      incrementMemberCount: false,
    };
  }

  if (!input.operational || !input.publicPreview) {
    return denied('community_unavailable');
  }

  if (input.join === 'invite_only') {
    return denied('invite_only');
  }

  if (!input.actorEligible) {
    return denied('actor_restricted');
  }

  if (!input.entitlementAllowed) {
    return denied('subscription_required');
  }

  const targetStatus: CommunityMembershipTargetStatus =
    input.join === 'open' ? 'active' : 'pending';

  return {
    allowed: true,
    targetStatus,
    denialReason: null,
    idempotent: false,
    incrementMemberCount: targetStatus === 'active',
  };
}
