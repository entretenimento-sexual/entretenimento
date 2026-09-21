// src/app/community/data-access/community-boost.model.ts
import {
  CommunityPreviewCard,
  normalizeCommunityDiscoveryPageResponse,
} from './community-preview.model';
import {
  sanitizeCommunityPublicDiscoveryPage,
} from './community-public-visibility.policy';

export interface CommunitySponsoredPlacement {
  readonly placementId: string;
  readonly campaignId: string;
  readonly disclosure: 'Patrocinado';
  readonly community: CommunityPreviewCard;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeCommunitySponsoredPlacement(
  raw: unknown
): CommunitySponsoredPlacement | null {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const placementId = cleanId(source['placementId']);
  const campaignId = cleanId(source['campaignId']);
  const communityPage = sanitizeCommunityPublicDiscoveryPage(
    normalizeCommunityDiscoveryPageResponse({
      items: [source['community']],
      nextCursor: null,
      generatedAt: Date.now(),
    })
  );
  const community = communityPage.items[0] ?? null;

  if (
    !placementId
    || !campaignId
    || source['disclosure'] !== 'Patrocinado'
    || !community
  ) {
    return null;
  }

  return {
    placementId,
    campaignId,
    disclosure: 'Patrocinado',
    community,
  };
}
