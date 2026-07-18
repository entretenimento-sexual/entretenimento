// functions/src/community/community-feed-access.policy.ts
import {
  CommunityFeedView,
  SanitizedCommunityFeedProjection,
} from './community-feed.model';

export function canViewerReadCommunityFeedAudience(
  projection: Readonly<SanitizedCommunityFeedProjection>,
  activeMembership: boolean
): boolean {
  return projection.audience === 'public_preview' || activeMembership;
}

export function canViewerReadCommunityFeedProjection(
  projection: Readonly<SanitizedCommunityFeedProjection>,
  view: CommunityFeedView,
  activeMembership: boolean
): boolean {
  if (!canViewerReadCommunityFeedAudience(projection, activeMembership)) {
    return false;
  }

  return view !== 'photos' || projection.item.kind === 'photo';
}
