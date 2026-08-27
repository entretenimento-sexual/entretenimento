// -----------------------------------------------------------------------------
// COMMUNITY FEED REACTION POLICY
// -----------------------------------------------------------------------------

import type { CommunityFeedWriterRole } from './community-feed-write.policy';

export type CommunityFeedReactionDenialReason =
  | 'community_unavailable'
  | 'active_membership_required'
  | 'post_unavailable';

export interface CommunityFeedReactionDecision {
  allowed: boolean;
  denialReason: CommunityFeedReactionDenialReason | null;
}

export function evaluateCommunityFeedReaction(input: {
  sourceType: unknown;
  memberActivityAllowed: boolean;
  membershipStatus: unknown;
  viewerRole: CommunityFeedWriterRole;
  postStatus: unknown;
  postModerationState: unknown;
}): Readonly<CommunityFeedReactionDecision> {
  if (input.sourceType !== 'community' || !input.memberActivityAllowed) {
    return denied('community_unavailable');
  }
  if (input.membershipStatus !== 'active' || input.viewerRole === null) {
    return denied('active_membership_required');
  }
  if (input.postStatus !== 'active' || input.postModerationState !== 'active') {
    return denied('post_unavailable');
  }
  return { allowed: true, denialReason: null };
}

function denied(
  denialReason: CommunityFeedReactionDenialReason
): CommunityFeedReactionDecision {
  return { allowed: false, denialReason };
}
