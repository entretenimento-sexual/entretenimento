// functions/src/community/community-feed-access.policy.ts
import {
  CommunityFeedView,
  SanitizedCommunityFeedProjection,
} from './community-feed.model';

export function canViewerReadCommunityFeedProjection(
  projection: Readonly<SanitizedCommunityFeedProjection>,
  view: CommunityFeedView,
  activeMembership: boolean
): boolean {
  if (projection.audience === 'members_only' && !activeMembership) {
    return false;
  }

  if (view === 'photos' && projection.item.kind !== 'photo') {
    return false;
  }

  return true;
}
