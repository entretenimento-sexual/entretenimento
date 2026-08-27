// functions/src/community/community-invite.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY INVITE POLICY
// -----------------------------------------------------------------------------
// Política pura para autorização e transições de convites de Comunidade.
// Autenticação, elegibilidade adulta, entitlement, bloqueios e I/O permanecem
// responsabilidade dos handlers.
// -----------------------------------------------------------------------------

import type {
  CommunityMembershipRole,
  CommunityMembershipStatus,
} from './community-membership-request.policy';

export type CommunityInviteStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'revoked'
  | 'expired';

export type CommunityInviteResponseAction = 'accept' | 'decline';

export interface CommunityInviteSendInput {
  communityOperational: boolean;
  actorStatus: CommunityMembershipStatus | null;
  actorRole: CommunityMembershipRole | null;
  membersCanInvite: boolean;
  targetStatus: CommunityMembershipStatus | null;
  existingInviteStatus: CommunityInviteStatus | null;
  existingInviteExpired: boolean;
}

export interface CommunityInviteSendDecision {
  allowed: boolean;
  deduplicated: boolean;
  denialReason:
    | 'community_unavailable'
    | 'inviter_not_allowed'
    | 'target_already_member'
    | 'target_blocked'
    | null;
}

export interface CommunityInviteRespondInput {
  action: CommunityInviteResponseAction;
  inviteStatus: CommunityInviteStatus | null;
  inviteExpired: boolean;
  communityOperational: boolean;
  targetStatus: CommunityMembershipStatus | null;
}

export interface CommunityInviteRespondDecision {
  allowed: boolean;
  deduplicated: boolean;
  nextInviteStatus: 'accepted' | 'declined' | null;
  activateMembership: boolean;
  incrementMemberCount: boolean;
  denialReason:
    | 'invite_unavailable'
    | 'invite_expired'
    | 'community_unavailable'
    | 'membership_blocked'
    | null;
}

export interface CommunityInviteRevokeInput {
  actorStatus: CommunityMembershipStatus | null;
  actorRole: CommunityMembershipRole | null;
  membersCanInvite: boolean;
  actorIsOriginalSender: boolean;
  inviteStatus: CommunityInviteStatus | null;
}

export interface CommunityInviteRevokeDecision {
  allowed: boolean;
  deduplicated: boolean;
  denialReason: 'inviter_not_allowed' | 'invite_unavailable' | null;
}

export function canSendCommunityInvite(
  status: CommunityMembershipStatus | null,
  role: CommunityMembershipRole | null,
  membersCanInvite: boolean
): boolean {
  if (status !== 'active') return false;

  return role === 'owner'
    || role === 'admin'
    || role === 'moderator'
    || (role === 'member' && membersCanInvite);
}

export function evaluateCommunityInviteSend(
  input: Readonly<CommunityInviteSendInput>
): Readonly<CommunityInviteSendDecision> {
  if (!input.communityOperational) {
    return {
      allowed: false,
      deduplicated: false,
      denialReason: 'community_unavailable',
    };
  }

  if (!canSendCommunityInvite(
    input.actorStatus,
    input.actorRole,
    input.membersCanInvite
  )) {
    return {
      allowed: false,
      deduplicated: false,
      denialReason: 'inviter_not_allowed',
    };
  }

  if (input.targetStatus === 'blocked') {
    return {
      allowed: false,
      deduplicated: false,
      denialReason: 'target_blocked',
    };
  }

  if (input.targetStatus === 'active') {
    return {
      allowed: false,
      deduplicated: false,
      denialReason: 'target_already_member',
    };
  }

  if (
    input.existingInviteStatus === 'pending'
    && !input.existingInviteExpired
  ) {
    return {
      allowed: true,
      deduplicated: true,
      denialReason: null,
    };
  }

  return {
    allowed: true,
    deduplicated: false,
    denialReason: null,
  };
}

export function evaluateCommunityInviteResponse(
  input: Readonly<CommunityInviteRespondInput>
): Readonly<CommunityInviteRespondDecision> {
  const desiredStatus = input.action === 'accept' ? 'accepted' : 'declined';

  if (input.inviteStatus === desiredStatus) {
    return {
      allowed: true,
      deduplicated: true,
      nextInviteStatus: desiredStatus,
      activateMembership: false,
      incrementMemberCount: false,
      denialReason: null,
    };
  }

  if (input.inviteStatus !== 'pending') {
    return {
      allowed: false,
      deduplicated: false,
      nextInviteStatus: null,
      activateMembership: false,
      incrementMemberCount: false,
      denialReason: 'invite_unavailable',
    };
  }

  if (input.inviteExpired) {
    return {
      allowed: false,
      deduplicated: false,
      nextInviteStatus: null,
      activateMembership: false,
      incrementMemberCount: false,
      denialReason: 'invite_expired',
    };
  }

  if (input.action === 'decline') {
    return {
      allowed: true,
      deduplicated: false,
      nextInviteStatus: 'declined',
      activateMembership: false,
      incrementMemberCount: false,
      denialReason: null,
    };
  }

  if (!input.communityOperational) {
    return {
      allowed: false,
      deduplicated: false,
      nextInviteStatus: null,
      activateMembership: false,
      incrementMemberCount: false,
      denialReason: 'community_unavailable',
    };
  }

  if (input.targetStatus === 'blocked') {
    return {
      allowed: false,
      deduplicated: false,
      nextInviteStatus: null,
      activateMembership: false,
      incrementMemberCount: false,
      denialReason: 'membership_blocked',
    };
  }

  return {
    allowed: true,
    deduplicated: false,
    nextInviteStatus: 'accepted',
    activateMembership: input.targetStatus !== 'active',
    incrementMemberCount: input.targetStatus !== 'active',
    denialReason: null,
  };
}

export function evaluateCommunityInviteRevoke(
  input: Readonly<CommunityInviteRevokeInput>
): Readonly<CommunityInviteRevokeDecision> {
  if (input.inviteStatus === 'revoked') {
    return {
      allowed: true,
      deduplicated: true,
      denialReason: null,
    };
  }

  if (input.inviteStatus !== 'pending') {
    return {
      allowed: false,
      deduplicated: false,
      denialReason: 'invite_unavailable',
    };
  }

  if (
    !input.actorIsOriginalSender
    && !canSendCommunityInvite(
      input.actorStatus,
      input.actorRole,
      input.membersCanInvite
    )
  ) {
    return {
      allowed: false,
      deduplicated: false,
      denialReason: 'inviter_not_allowed',
    };
  }

  return {
    allowed: true,
    deduplicated: false,
    denialReason: null,
  };
}
