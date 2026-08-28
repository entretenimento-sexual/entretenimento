// -----------------------------------------------------------------------------
// COMMUNITY FEED COMMENT POLICY
// -----------------------------------------------------------------------------

import type {
  CommunityFeedCommentAction,
  CommunityFeedCommentStatus,
} from './community-feed-comment.model';
import type { CommunityFeedWriterRole } from './community-feed-write.policy';

export type CommunityFeedCommentWriteDenialReason =
  | 'community_unavailable'
  | 'active_membership_required'
  | 'post_unavailable';

export interface CommunityFeedCommentWriteDecision {
  allowed: boolean;
  denialReason: CommunityFeedCommentWriteDenialReason | null;
}

export type CommunityFeedCommentActionDenialReason =
  | 'comment_unavailable'
  | 'comment_author_required'
  | 'active_management_required'
  | 'removal_reason_required';

export interface CommunityFeedCommentActionDecision {
  allowed: boolean;
  denialReason: CommunityFeedCommentActionDenialReason | null;
  idempotent: boolean;
  nextStatus: CommunityFeedCommentStatus | null;
  nextModerationState: 'active' | 'removed' | null;
}

function isManagementRole(role: CommunityFeedWriterRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'moderator';
}

export function isCommunityFeedInteractivePostKind(kind: unknown): boolean {
  return kind === 'text' || kind === 'photo' || kind === 'location';
}

export function evaluateCommunityFeedCommentWrite(input: {
  sourceType: unknown;
  memberActivityAllowed: boolean;
  membershipStatus: unknown;
  viewerRole: CommunityFeedWriterRole;
  postKind: unknown;
  postStatus: unknown;
  postModerationState: unknown;
}): Readonly<CommunityFeedCommentWriteDecision> {
  if (input.sourceType !== 'community' || !input.memberActivityAllowed) {
    return { allowed: false, denialReason: 'community_unavailable' };
  }
  if (input.membershipStatus !== 'active' || input.viewerRole === null) {
    return { allowed: false, denialReason: 'active_membership_required' };
  }
  if (
    !isCommunityFeedInteractivePostKind(input.postKind)
    || input.postStatus !== 'active'
    || input.postModerationState !== 'active'
  ) {
    return { allowed: false, denialReason: 'post_unavailable' };
  }
  return { allowed: true, denialReason: null };
}

export function evaluateCommunityFeedCommentAction(input: {
  action: CommunityFeedCommentAction;
  sourceType: unknown;
  memberActivityAllowed: boolean;
  actorUid: string;
  authorUid: string;
  membershipStatus: unknown;
  viewerRole: CommunityFeedWriterRole;
  currentStatus: CommunityFeedCommentStatus | null;
  currentModerationState: 'active' | 'removed' | null;
  reason: string | null;
}): Readonly<CommunityFeedCommentActionDecision> {
  const nextStatus = input.action === 'delete_own' ? 'deleted' : 'removed';
  const nextModerationState = input.action === 'remove' ? 'removed' : 'active';

  if (input.sourceType !== 'community' || !input.currentStatus) {
    return deniedAction('comment_unavailable');
  }
  if (input.action === 'delete_own' && input.actorUid !== input.authorUid) {
    return deniedAction('comment_author_required');
  }
  if (
    input.action === 'remove'
    && (
      !input.memberActivityAllowed
      || input.membershipStatus !== 'active'
      || !isManagementRole(input.viewerRole)
    )
  ) {
    return deniedAction('active_management_required');
  }
  if (input.action === 'remove' && String(input.reason ?? '').trim().length < 3) {
    return deniedAction('removal_reason_required');
  }
  if (
    input.currentStatus === nextStatus
    && input.currentModerationState === nextModerationState
  ) {
    return {
      allowed: true,
      denialReason: null,
      idempotent: true,
      nextStatus,
      nextModerationState,
    };
  }
  if (
    input.currentStatus !== 'active'
    || input.currentModerationState !== 'active'
  ) {
    return deniedAction('comment_unavailable');
  }
  return {
    allowed: true,
    denialReason: null,
    idempotent: false,
    nextStatus,
    nextModerationState,
  };
}

function deniedAction(
  denialReason: CommunityFeedCommentActionDenialReason
): CommunityFeedCommentActionDecision {
  return {
    allowed: false,
    denialReason,
    idempotent: false,
    nextStatus: null,
    nextModerationState: null,
  };
}
