// src/app/dashboard/principal/principal-feed.model.ts
// -----------------------------------------------------------------------------
// Contrato canônico do fluxo principal.
//
// Decisão:
// - mídia pública (foto + vídeo) representa atualização cronológica de perfil;
// - vídeo chega apenas como preview autorizado; playback nasce no viewer;
// - conexões e compatíveis recebem prioridade privada e limitada;
// - mídia vista recentemente é adiada, nunca removida;
// - a parcela global continua dominante e nenhum score público é alterado;
// - Comunidades e Locais entram como descoberta contextual;
// - itens de descoberta não recebem timestamp artificial;
// - a intercalação é pura e determinística para facilitar cache e testes.
// -----------------------------------------------------------------------------

import type { CommunityPreviewCard } from 'src/app/community/data-access/community-preview.model';
import type { IPublicMediaContinuationContext } from 'src/app/core/interfaces/media/i-public-media-continuation-context';
import {
  IPublicProfileMediaItem,
  isPublicVideoItem,
} from 'src/app/core/interfaces/media/i-public-profile-media-item';
import type { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { composePublicProfileMediaPriority } from 'src/app/core/utils/media/public-profile-media-priority';

export type PrincipalFeedSource =
  | 'photos'
  | 'videos'
  | 'connections'
  | 'compatibility'
  | 'personalizedPhotos'
  | 'personalizedVideos'
  | 'recentViews'
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
  readonly continuationContext?: IPublicMediaContinuationContext;
}

export const PRINCIPAL_FEED_LOADING_STATE: PrincipalFeedState = Object.freeze({
  status: 'loading',
  items: [],
  photos: [],
  videos: [],
  failedSources: [],
});

function buildProfileMediaItems(
  photos: readonly IPublicPhotoItem[],
  videos: readonly IPublicVideoItem[],
  connectionOwnerUids: readonly string[] = [],
  compatibleOwnerUids: readonly string[] = [],
  recentViewedKeys: readonly string[] = []
): PrincipalFeedItem[] {
  const orderedMedia = composePublicProfileMediaPriority(
    [
      ...(photos as readonly IPublicProfileMediaItem[]),
      ...(videos as readonly IPublicProfileMediaItem[]),
    ],
    {
      connectionOwnerUids,
      compatibleOwnerUids,
      recentViewedKeys,
    }
  );

  return orderedMedia.map((item): PrincipalFeedItem => {
    if (isPublicVideoItem(item)) {
      return {
        id: `profile-video:${item.ownerUid}:${item.id}`,
        kind: 'profile-video',
        video: item,
      };
    }

    return {
      id: `profile-photo:${item.ownerUid}:${item.id}`,
      kind: 'profile-photo',
      photo: item,
    };
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
 * Insere uma descoberta a cada duas atualizações de mídia do perfil.
 *
 * A personalização e a novidade são aplicadas somente à ordem relativa da
 * mídia antes da intercalação de Comunidades/Locais.
 */
export function buildPrincipalFeedItems(
  photos: readonly IPublicPhotoItem[],
  videos: readonly IPublicVideoItem[],
  communities: readonly CommunityPreviewCard[],
  venues: readonly CommunityPreviewCard[],
  maxItems = 24,
  connectionOwnerUids: readonly string[] = [],
  compatibleOwnerUids: readonly string[] = [],
  recentViewedKeys: readonly string[] = []
): PrincipalFeedItem[] {
  const safeMaxItems = Number.isFinite(maxItems)
    ? Math.min(Math.max(Math.trunc(maxItems), 1), 60)
    : 24;
  const profileItems = buildProfileMediaItems(
    photos,
    videos,
    connectionOwnerUids,
    compatibleOwnerUids,
    recentViewedKeys
  );
  const discoveryItems = interleaveDiscovery(communities, venues);
  const result: PrincipalFeedItem[] = [];
  let discoveryIndex = 0;

  for (let index = 0; index < profileItems.length; index += 1) {
    result.push(profileItems[index]);

    const shouldInsertDiscovery = (index + 1) % 2 === 0;
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
