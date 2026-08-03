// src/app/dashboard/principal/principal-feed.model.ts
// -----------------------------------------------------------------------------
// Contrato canônico do fluxo principal.
//
// Decisão:
// - fotos e vídeos públicos representam atualizações cronológicas de perfil;
// - Comunidades e Locais entram como descoberta contextual;
// - itens de descoberta não recebem timestamp artificial;
// - a intercalação é pura e determinística para facilitar cache e testes.
// -----------------------------------------------------------------------------

import type { CommunityPreviewCard } from 'src/app/community/data-access/community-preview.model';
import type { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';

export type PrincipalFeedSource =
  | 'profiles'
  | 'videos'
  | 'communities'
  | 'venues';

export type PrincipalFeedItem =
  | {
      readonly id: string;
      readonly kind: 'profile-photo';
      readonly photo: IPublicPhotoItem;
    }
  | {
      readonly id: string;
      readonly kind: 'profile-video';
      readonly video: IPublicVideoItem;
    }
  | {
      readonly id: string;
      readonly kind: 'community' | 'venue';
      readonly space: CommunityPreviewCard;
    };

export type PrincipalFeedStatus = 'loading' | 'ready' | 'empty' | 'error';

export interface PrincipalFeedState {
  readonly status: PrincipalFeedStatus;
  readonly items: readonly PrincipalFeedItem[];
  readonly photos: readonly IPublicPhotoItem[];
  readonly videos: readonly IPublicVideoItem[];
  readonly failedSources: readonly PrincipalFeedSource[];
}

export const PRINCIPAL_FEED_LOADING_STATE: PrincipalFeedState = Object.freeze({
  status: 'loading',
  items: [],
  photos: [],
  videos: [],
  failedSources: [],
});

function safePublishedAt(value: unknown): number {
  const normalized = Number(value ?? 0);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : 0;
}

function uniquePhotos(items: readonly IPublicPhotoItem[]): IPublicPhotoItem[] {
  const unique = new Map<string, IPublicPhotoItem>();

  for (const item of items) {
    const id = String(item?.id ?? '').trim();
    const ownerUid = String(item?.ownerUid ?? '').trim();
    const url = String(item?.url ?? '').trim();

    if (!id || !ownerUid || !url) continue;
    unique.set(`${ownerUid}:${id}`, item);
  }

  return [...unique.values()].sort(
    (left, right) =>
      safePublishedAt(right.publishedAt) - safePublishedAt(left.publishedAt)
  );
}

function uniqueVideos(items: readonly IPublicVideoItem[]): IPublicVideoItem[] {
  const unique = new Map<string, IPublicVideoItem>();

  for (const item of items) {
    const id = String(item?.id ?? '').trim();
    const ownerUid = String(item?.ownerUid ?? '').trim();
    const url = String(item?.url ?? '').trim();

    if (!id || !ownerUid || !url) continue;
    unique.set(`${ownerUid}:${id}`, item);
  }

  return [...unique.values()].sort(
    (left, right) =>
      safePublishedAt(right.publishedAt) - safePublishedAt(left.publishedAt)
  );
}

function profileMediaItems(
  photos: readonly IPublicPhotoItem[],
  videos: readonly IPublicVideoItem[]
): PrincipalFeedItem[] {
  const photoItems: PrincipalFeedItem[] = uniquePhotos(photos).map((photo) => ({
    id: `profile-photo:${photo.ownerUid}:${photo.id}`,
    kind: 'profile-photo',
    photo,
  }));
  const videoItems: PrincipalFeedItem[] = uniqueVideos(videos).map((video) => ({
    id: `profile-video:${video.ownerUid}:${video.id}`,
    kind: 'profile-video',
    video,
  }));

  return [...photoItems, ...videoItems].sort((left, right) => {
    const leftPublishedAt = left.kind === 'profile-photo'
      ? safePublishedAt(left.photo.publishedAt)
      : left.kind === 'profile-video'
        ? safePublishedAt(left.video.publishedAt)
        : 0;
    const rightPublishedAt = right.kind === 'profile-photo'
      ? safePublishedAt(right.photo.publishedAt)
      : right.kind === 'profile-video'
        ? safePublishedAt(right.video.publishedAt)
        : 0;
    const dateDifference = rightPublishedAt - leftPublishedAt;

    return dateDifference || left.id.localeCompare(right.id);
  });
}

function uniqueSpaces(
  items: readonly CommunityPreviewCard[],
  kind: 'community' | 'venue'
): PrincipalFeedItem[] {
  const unique = new Map<string, CommunityPreviewCard>();

  for (const item of items) {
    const id = String(item?.communityId ?? '').trim();
    if (!id || item.source.type !== kind) continue;
    unique.set(id, item);
  }

  return [...unique.values()].map((space) => ({
    id: `${kind}:${space.communityId}`,
    kind,
    space,
  }));
}

function interleaveDiscovery(
  communities: readonly CommunityPreviewCard[],
  venues: readonly CommunityPreviewCard[]
): PrincipalFeedItem[] {
  const communityItems = uniqueSpaces(communities, 'community');
  const venueItems = uniqueSpaces(venues, 'venue');
  const result: PrincipalFeedItem[] = [];
  const maxLength = Math.max(communityItems.length, venueItems.length);

  for (let index = 0; index < maxLength; index += 1) {
    const community = communityItems[index];
    const venue = venueItems[index];

    if (community) result.push(community);
    if (venue) result.push(venue);
  }

  return result;
}

/**
 * Insere uma descoberta a cada três atualizações de perfil.
 *
 * Fotos e vídeos compartilham a mesma sequência cronológica. Quando não há
 * mídia pública, Comunidades e Locais continuam aparecendo. Quando não há
 * descoberta, o fluxo permanece exclusivamente cronológico.
 */
export function buildPrincipalFeedItems(
  photos: readonly IPublicPhotoItem[],
  videos: readonly IPublicVideoItem[],
  communities: readonly CommunityPreviewCard[],
  venues: readonly CommunityPreviewCard[],
  maxItems = 24
): PrincipalFeedItem[] {
  const safeMaxItems = Number.isFinite(maxItems)
    ? Math.min(Math.max(Math.trunc(maxItems), 1), 60)
    : 24;
  const mediaItems = profileMediaItems(photos, videos);
  const discoveryItems = interleaveDiscovery(communities, venues);
  const result: PrincipalFeedItem[] = [];
  let discoveryIndex = 0;

  for (let index = 0; index < mediaItems.length; index += 1) {
    result.push(mediaItems[index]);

    const shouldInsertDiscovery = (index + 1) % 3 === 0;
    if (shouldInsertDiscovery && discoveryIndex < discoveryItems.length) {
      result.push(discoveryItems[discoveryIndex]);
      discoveryIndex += 1;
    }

    if (result.length >= safeMaxItems) {
      return result.slice(0, safeMaxItems);
    }
  }

  while (discoveryIndex < discoveryItems.length && result.length < safeMaxItems) {
    result.push(discoveryItems[discoveryIndex]);
    discoveryIndex += 1;
  }

  return result.slice(0, safeMaxItems);
}
