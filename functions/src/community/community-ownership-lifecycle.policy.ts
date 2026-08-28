// functions/src/community/community-ownership-lifecycle.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY OWNERSHIP LIFECYCLE POLICY
// -----------------------------------------------------------------------------
// Política pura para transferência de propriedade e arquivamento seguro.
// Handlers permanecem responsáveis por autenticação, leituras canônicas,
// transações, idempotência persistida e auditoria.
// -----------------------------------------------------------------------------

export type CommunityOwnershipSourceType = 'community' | 'venue' | null;
export type CommunityOwnershipStatus = 'active' | 'paused' | 'archived' | null;
export type CommunityOwnershipMembershipStatus =
  | 'active'
  | 'pending'
  | 'blocked'
  | 'left'
  | null;
export type CommunityOwnershipMembershipRole =
  | 'owner'
  | 'admin'
  | 'moderator'
  | 'member'
  | null;

export type CommunityOwnershipTransferDenialReason =
  | 'community_unavailable'
  | 'community_source_not_supported'
  | 'owner_required'
  | 'ownership_inconsistent'
  | 'self_transfer_forbidden'
  | 'target_membership_ineligible'
  | 'target_account_ineligible';

export interface CommunityOwnershipTransferInput {
  sourceType: CommunityOwnershipSourceType;
  communityStatus: CommunityOwnershipStatus;
  actorUid: string;
  targetUid: string;
  actorStatus: CommunityOwnershipMembershipStatus;
  actorRole: CommunityOwnershipMembershipRole;
  targetStatus: CommunityOwnershipMembershipStatus;
  targetRole: CommunityOwnershipMembershipRole;
  targetAccountEligible: boolean;
  activeOwnerCount: number;
}

export interface CommunityOwnershipTransferDecision {
  allowed: boolean;
  denialReason: CommunityOwnershipTransferDenialReason | null;
  actorNextRole: 'member' | null;
  targetNextRole: 'owner' | null;
}

export type CommunityArchiveDenialReason =
  | 'community_unavailable'
  | 'community_source_not_supported'
  | 'owner_required'
  | 'ownership_inconsistent'
  | 'community_lifecycle_hold';

export interface CommunityArchiveInput {
  sourceType: CommunityOwnershipSourceType;
  communityStatus: CommunityOwnershipStatus;
  actorStatus: CommunityOwnershipMembershipStatus;
  actorRole: CommunityOwnershipMembershipRole;
  activeOwnerCount: number;
  lifecycleHold: boolean;
}

export interface CommunityArchiveDecision {
  allowed: boolean;
  idempotent: boolean;
  denialReason: CommunityArchiveDenialReason | null;
  actorNextRole: 'member' | null;
  actorNextStatus: 'left' | null;
}

export function evaluateCommunityOwnershipTransfer(
  input: Readonly<CommunityOwnershipTransferInput>
): CommunityOwnershipTransferDecision {
  if (input.sourceType !== 'community') {
    return deniedTransfer('community_source_not_supported');
  }

  if (input.communityStatus !== 'active' && input.communityStatus !== 'paused') {
    return deniedTransfer('community_unavailable');
  }

  if (input.activeOwnerCount !== 1) {
    return deniedTransfer('ownership_inconsistent');
  }

  if (input.actorStatus !== 'active' || input.actorRole !== 'owner') {
    return deniedTransfer('owner_required');
  }

  if (!input.actorUid || input.actorUid === input.targetUid) {
    return deniedTransfer('self_transfer_forbidden');
  }

  if (
    input.targetStatus !== 'active'
    || (input.targetRole !== 'admin'
      && input.targetRole !== 'moderator'
      && input.targetRole !== 'member')
  ) {
    return deniedTransfer('target_membership_ineligible');
  }

  if (!input.targetAccountEligible) {
    return deniedTransfer('target_account_ineligible');
  }

  return {
    allowed: true,
    denialReason: null,
    actorNextRole: 'member',
    targetNextRole: 'owner',
  };
}

export function evaluateCommunityArchive(
  input: Readonly<CommunityArchiveInput>
): CommunityArchiveDecision {
  if (input.sourceType !== 'community') {
    return deniedArchive('community_source_not_supported');
  }

  if (input.communityStatus === 'archived') {
    return {
      allowed: true,
      idempotent: true,
      denialReason: null,
      actorNextRole: null,
      actorNextStatus: null,
    };
  }

  if (input.communityStatus !== 'active' && input.communityStatus !== 'paused') {
    return deniedArchive('community_unavailable');
  }

  if (input.activeOwnerCount !== 1) {
    return deniedArchive('ownership_inconsistent');
  }

  if (input.actorStatus !== 'active' || input.actorRole !== 'owner') {
    return deniedArchive('owner_required');
  }

  if (input.lifecycleHold) {
    return deniedArchive('community_lifecycle_hold');
  }

  return {
    allowed: true,
    idempotent: false,
    denialReason: null,
    actorNextRole: 'member',
    actorNextStatus: 'left',
  };
}

function deniedTransfer(
  denialReason: CommunityOwnershipTransferDenialReason
): CommunityOwnershipTransferDecision {
  return {
    allowed: false,
    denialReason,
    actorNextRole: null,
    targetNextRole: null,
  };
}

function deniedArchive(
  denialReason: CommunityArchiveDenialReason
): CommunityArchiveDecision {
  return {
    allowed: false,
    idempotent: false,
    denialReason,
    actorNextRole: null,
    actorNextStatus: null,
  };
}
