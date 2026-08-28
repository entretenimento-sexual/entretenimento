// -----------------------------------------------------------------------------
// COMMUNITY FEED MODERATION POLICY
// -----------------------------------------------------------------------------

import type {
  CommunityFeedPostAction,
  CommunityFeedPostOperationalStatus,
} from './community-feed-moderation.model';
import type { CommunityFeedWriterRole } from './community-feed-write.policy';

export type CommunityFeedPostActionDenialReason =
  | 'post_unavailable'
  | 'post_author_required'
  | 'active_management_required'
  | 'removal_reason_required';

export interface CommunityFeedPostActionDecision {
  allowed: boolean;
  denialReason: CommunityFeedPostActionDenialReason | null;
  idempotent: boolean;
  nextStatus: CommunityFeedPostOperationalStatus | null;
  nextModerationState: 'active' | 'removed' | null;
}

function isManagementRole(role: CommunityFeedWriterRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'moderator';
}

export function evaluateCommunityFeedPostAction(input: {
  action: CommunityFeedPostAction;
  sourceType: unknown;
  actorUid: string;
  authorUid: string;
  membershipStatus: unknown;
  viewerRole: CommunityFeedWriterRole;
  currentStatus: CommunityFeedPostOperationalStatus | null;
  currentModerationState: 'active' | 'removed' | null;
  reason: string | null;
}): Readonly<CommunityFeedPostActionDecision> {
  const targetStatus = input.action === 'delete_own' ? 'deleted' : 'removed';
  const targetModerationState = input.action === 'remove' ? 'removed' : 'active';

  if (input.sourceType !== 'community' || !input.currentStatus) {
    return denied('post_unavailable');
  }

  if (input.action === 'delete_own' && input.actorUid !== input.authorUid) {
    return denied('post_author_required');
  }

  if (
    input.action === 'remove'
    && (
      input.membershipStatus !== 'active'
      || !isManagementRole(input.viewerRole)
    )
  ) {
    return denied('active_management_required');
  }

  if (
    input.action === 'remove'
    && String(input.reason ?? '').trim().length < 3
  ) {
    return denied('removal_reason_required');
  }

  if (
    input.currentStatus === targetStatus
    && input.currentModerationState === targetModerationState
  ) {
    return {
      allowed: true,
      denialReason: null,
      idempotent: true,
      nextStatus: targetStatus,
      nextModerationState: targetModerationState,
    };
  }

  if (
    input.currentStatus !== 'active'
    || input.currentModerationState !== 'active'
  ) {
    return denied('post_unavailable');
  }

  return {
    allowed: true,
    denialReason: null,
    idempotent: false,
    nextStatus: targetStatus,
    nextModerationState: targetModerationState,
  };
}

function denied(
  denialReason: CommunityFeedPostActionDenialReason
): CommunityFeedPostActionDecision {
  return {
    allowed: false,
    denialReason,
    idempotent: false,
    nextStatus: null,
    nextModerationState: null,
  };
}
