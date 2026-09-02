import type {
  CommunityDiscoveryPage,
  CommunityPreviewCard,
} from './community-preview.model';

/**
 * Public community surfaces must never expose viewer-specific membership
 * context. The backend remains authoritative, but this client boundary keeps
 * accidental `viewerRole` leakage from reaching discovery/profile UI.
 *
 * Private "Minhas Comunidades" responses intentionally do not pass through
 * this policy because the role belongs to the authenticated viewer there.
 */
export function sanitizeCommunityPublicDiscoveryPage(
  page: CommunityDiscoveryPage
): CommunityDiscoveryPage {
  return {
    ...page,
    items: page.items.map(stripPrivateCommunityCardContext),
  };
}

function stripPrivateCommunityCardContext(
  card: CommunityPreviewCard
): CommunityPreviewCard {
  const { viewerRole: _viewerRole, ...publicCard } = card;
  return publicCard;
}
