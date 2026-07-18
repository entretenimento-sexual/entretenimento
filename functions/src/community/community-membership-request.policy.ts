// functions/src/community/community-membership-request.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBERSHIP POLICY
// -----------------------------------------------------------------------------
// Decide transições sem acessar Firebase. As callables continuam responsáveis
// por autenticação, perfil, entitlement, transação, métricas e auditoria.
// -----------------------------------------------------------------------------

export type CommunityJoinPolicy = 'open' | 'approval' | 'invite_only';
export type CommunityMembershipStatus = 'active' | 'pending' | 'blocked' | 'left';
export type CommunityMembershipTargetStatus = 'active' | 'pending';
export type CommunityMembershipRole = 'owner' | 'admin' | 'moderator' | 'member';
export type CommunityMembershipReviewAction = 'approve' | 'reject';

export type CommunityMembershipDenialReason =
  | 'community_unavailable'
  | 'invite_only'
  | 'membership_blocked'
  | 'actor_restricted'
  | 'subscription_required';

export type CommunityMembershipLeaveDenialReason =
  | 'membership_not_found'
  | 'membership_blocked'
  | 'owner_transfer_required';

export type CommunityMembershipReviewDenialReason =
  | 'moderator_required'
  | 'self_review_forbidden'
  | 'membership_blocked'
  | 'protected_membership'
  | 'request_not_pending';

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

export interface CommunityMembershipLeaveInput {
  existingStatus: CommunityMembershipStatus | null;
  existingRole: CommunityMembershipRole | null;
}

export interface CommunityMembershipLeaveDecision {
  allowed: boolean;
  targetStatus: 'left' | null;
  denialReason: CommunityMembershipLeaveDenialReason | null;
  idempotent: boolean;
  decrementMemberCount: boolean;
  auditAction:
    | 'community-membership-left'
    | 'community-membership-request-cancelled'
    | null;
}

export interface CommunityMembershipReviewInput {
  actorActive: boolean;
  actorRole: CommunityMembershipRole | null;
  targetIsActor: boolean;
  targetStatus: CommunityMembershipStatus | null;
  targetRole: CommunityMembershipRole | null;
  action: CommunityMembershipReviewAction;
}

export interface CommunityMembershipReviewDecision {
  allowed: boolean;
  targetStatus: 'active' | 'left' | null;
  denialReason: CommunityMembershipReviewDenialReason | null;
  idempotent: boolean;
  incrementMemberCount: boolean;
  auditAction:
    | 'community-membership-approved'
    | 'community-membership-rejected'
    | null;
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

export function evaluateCommunityMembershipLeave(
  input: Readonly<CommunityMembershipLeaveInput>
): Readonly<CommunityMembershipLeaveDecision> {
  if (input.existingStatus === 'blocked') {
    return {
      allowed: false,
      targetStatus: null,
      denialReason: 'membership_blocked',
      idempotent: false,
      decrementMemberCount: false,
      auditAction: null,
    };
  }

  if (input.existingStatus === 'left') {
    return {
      allowed: true,
      targetStatus: 'left',
      denialReason: null,
      idempotent: true,
      decrementMemberCount: false,
      auditAction: null,
    };
  }

  if (input.existingStatus === null || input.existingRole === null) {
    return {
      allowed: false,
      targetStatus: null,
      denialReason: 'membership_not_found',
      idempotent: false,
      decrementMemberCount: false,
      auditAction: null,
    };
  }

  if (input.existingStatus === 'active' && input.existingRole === 'owner') {
    return {
      allowed: false,
      targetStatus: null,
      denialReason: 'owner_transfer_required',
      idempotent: false,
      decrementMemberCount: false,
      auditAction: null,
    };
  }

  return {
    allowed: true,
    targetStatus: 'left',
    denialReason: null,
    idempotent: false,
    decrementMemberCount: input.existingStatus === 'active',
    auditAction: input.existingStatus === 'active'
      ? 'community-membership-left'
      : 'community-membership-request-cancelled',
  };
}

export function evaluateCommunityMembershipReview(
  input: Readonly<CommunityMembershipReviewInput>
): Readonly<CommunityMembershipReviewDecision> {
  const actorCanReview =
    input.actorActive
    && (
      input.actorRole === 'owner'
      || input.actorRole === 'admin'
      || input.actorRole === 'moderator'
    );

  if (!actorCanReview) {
    return {
      allowed: false,
      targetStatus: null,
      denialReason: 'moderator_required',
      idempotent: false,
      incrementMemberCount: false,
      auditAction: null,
    };
  }

  if (input.targetIsActor) {
    return {
      allowed: false,
      targetStatus: null,
      denialReason: 'self_review_forbidden',
      idempotent: false,
      incrementMemberCount: false,
      auditAction: null,
    };
  }

  if (input.targetStatus === 'blocked') {
    return {
      allowed: false,
      targetStatus: null,
      denialReason: 'membership_blocked',
      idempotent: false,
      incrementMemberCount: false,
      auditAction: null,
    };
  }

  if (input.targetRole !== 'member') {
    return {
      allowed: false,
      targetStatus: null,
      denialReason: 'protected_membership',
      idempotent: false,
      incrementMemberCount: false,
      auditAction: null,
    };
  }

  if (input.action === 'approve' && input.targetStatus === 'active') {
    return {
      allowed: true,
      targetStatus: 'active',
      denialReason: null,
      idempotent: true,
      incrementMemberCount: false,
      auditAction: null,
    };
  }

  if (input.action === 'reject' && input.targetStatus === 'left') {
    return {
      allowed: true,
      targetStatus: 'left',
      denialReason: null,
      idempotent: true,
      incrementMemberCount: false,
      auditAction: null,
    };
  }

  if (input.targetStatus !== 'pending') {
    return {
      allowed: false,
      targetStatus: null,
      denialReason: 'request_not_pending',
      idempotent: false,
      incrementMemberCount: false,
      auditAction: null,
    };
  }

  const approving = input.action === 'approve';

  return {
    allowed: true,
    targetStatus: approving ? 'active' : 'left',
    denialReason: null,
    idempotent: false,
    incrementMemberCount: approving,
    auditAction: approving
      ? 'community-membership-approved'
      : 'community-membership-rejected',
  };
}
