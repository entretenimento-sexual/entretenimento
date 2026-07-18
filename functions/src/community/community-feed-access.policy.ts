// functions/src/community/community-feed-access.policy.ts
import {
  CommunityFeedView,
  SanitizedCommunityFeedProjection,
} from './community-feed.model';

export function canViewerReadCommunityFeedAudience(
  projection: Readonly<SanitizedCommunityFeedProjection>,
  memberContentAccess: boolean
): boolean {
  return projection.audience === 'public_preview' || memberContentAccess;
}

export function canViewerReadCommunityFeedProjection(
  projection: Readonly<SanitizedCommunityFeedProjection>,
  view: CommunityFeedView,
  memberContentAccess: boolean
): boolean {
  if (!canViewerReadCommunityFeedAudience(projection, memberContentAccess)) {
    return false;
  }

  return view !== 'photos' || projection.item.kind === 'photo';
}
