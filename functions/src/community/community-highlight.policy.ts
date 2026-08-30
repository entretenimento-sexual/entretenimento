// -----------------------------------------------------------------------------
// COMMUNITY HIGHLIGHT POLICY
// -----------------------------------------------------------------------------
// O destaque pertence à gestão editorial da Comunidade. A V1 aceita somente
// publicação ativa do Mural e nunca altera sua ordem cronológica.
// -----------------------------------------------------------------------------

import type { CommunityHighlightAction } from './community-highlight.model';
import type { CommunityFeedWriterRole } from './community-feed-write.policy';

export type CommunityHighlightDenialReason =
  | 'community_source_not_supported'
  | 'active_management_required'
  | 'post_unavailable';

export interface CommunityHighlightDecision {
  allowed: boolean;
  denialReason: CommunityHighlightDenialReason | null;
}

function isManagementRole(role: CommunityFeedWriterRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'moderator';
}

export function evaluateCommunityHighlightAction(input: {
  action: CommunityHighlightAction;
  sourceType: unknown;
  membershipStatus: unknown;
  viewerRole: CommunityFeedWriterRole;
  targetPostStatus?: unknown;
  targetPostModerationState?: unknown;
}): Readonly<CommunityHighlightDecision> {
  if (input.sourceType !== 'community') {
    return denied('community_source_not_supported');
  }

  if (
    input.membershipStatus !== 'active'
    || !isManagementRole(input.viewerRole)
  ) {
    return denied('active_management_required');
  }

  if (
    input.action === 'pin'
    && (
      input.targetPostStatus !== 'active'
      || input.targetPostModerationState !== 'active'
    )
  ) {
    return denied('post_unavailable');
  }

  return { allowed: true, denialReason: null };
}

export function shouldClearCommunityHighlightForPostTransition(input: {
  highlightedTargetType: unknown;
  highlightedTargetId: unknown;
  postId: string;
  afterExists: boolean;
  afterStatus: unknown;
  afterModerationState: unknown;
}): boolean {
  if (
    input.highlightedTargetType !== 'feed_post'
    || input.highlightedTargetId !== input.postId
  ) {
    return false;
  }

  return !input.afterExists
    || input.afterStatus !== 'active'
    || input.afterModerationState !== 'active';
}

function denied(
  denialReason: CommunityHighlightDenialReason
): CommunityHighlightDecision {
  return { allowed: false, denialReason };
}
