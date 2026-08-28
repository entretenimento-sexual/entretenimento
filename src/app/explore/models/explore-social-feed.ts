import type { IUserIntentStatusCardVm } from 'src/app/core/interfaces/discovery/user-intent-status.interface';
import type { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import type { PublicProfileCard } from 'src/app/dashboard/discovery/models/public-profile-card.model';

export type ExploreSocialRelationship = 'friend' | 'compatible';

export interface ExploreSocialPhotoItem {
  readonly kind: 'photo';
  readonly key: string;
  readonly ownerUid: string;
  readonly publishedAt: number;
  readonly photo: IPublicPhotoItem;
}

export interface ExploreSocialVideoItem {
  readonly kind: 'video';
  readonly key: string;
  readonly ownerUid: string;
  readonly publishedAt: number;
  readonly video: IPublicVideoItem;
}

export interface ExploreSocialStatusItem {
  readonly kind: 'status';
  readonly key: string;
  readonly ownerUid: string;
  readonly publishedAt: number;
  readonly relationship: ExploreSocialRelationship;
  readonly status: IUserIntentStatusCardVm;
}

export type ExploreSocialMediaItem =
  | ExploreSocialPhotoItem
  | ExploreSocialVideoItem;

export type ExploreSocialFeedItem =
  | ExploreSocialMediaItem
  | ExploreSocialStatusItem;

export interface ExploreSocialFeedOptions {
  readonly limit?: number;
  /** Mantido por compatibilidade; agora representa mídias antes de um status. */
  readonly photosBeforeStatus?: number;
  readonly maxStatuses?: number;
  /** Quantidade máxima de mídias do mesmo autor em cada rodada de diversidade. */
  readonly maxMediaPerOwner?: number;
  readonly viewerUid?: string | null;
  readonly videos?: readonly IPublicVideoItem[] | null;
  /**
   * UIDs compatíveis adicionais já validados pelo pool canônico paginado.
   * Permite classificar mídia além da janela visual de `compatibleProfiles`.
   */
  readonly compatibleOwnerUids?: readonly string[] | null;
}

export interface ExploreSocialFeedWindow {
  readonly items: readonly ExploreSocialFeedItem[];
  readonly visibleCount: number;
  readonly totalItems: number;
  readonly remainingItems: number;
  readonly hasMore: boolean;
}

const DEFAULT_LIMIT = 36;
const DEFAULT_MEDIA_BEFORE_STATUS = 2;
const DEFAULT_MAX_STATUSES = 4;
const DEFAULT_MAX_MEDIA_PER_OWNER = 3;
const DEFAULT_VISIBLE_LIMIT = 6;

/**
 * Intercala momentos temporários em uma timeline pessoal realmente multimídia.
 *
 * Contrato:
 * - fotos e vídeos são limitados a autores amigos/compatíveis quando há vínculo;
 * - amigos precedem compatíveis e recência decide dentro do mesmo grupo;
 * - o próprio usuário é excluído dos momentos porque ocupa o primeiro cartão;
 * - no máximo um momento por autor e um momento a cada duas mídias;
 * - foto + vídeo são diversificados em rodadas por autor, sem descarte permanente;
 * - quando não há mídia, momentos relacionados ainda podem preencher o feed.
 */
export function buildExploreSocialFeed(
  photos: readonly IPublicPhotoItem[] | null | undefined,
  statuses: readonly IUserIntentStatusCardVm[] | null | undefined,
  friendUids: readonly string[] | null | undefined,
  compatibleProfiles: readonly PublicProfileCard[] | null | undefined,
  options: ExploreSocialFeedOptions = {}
): ExploreSocialFeedItem[] {
  const limit = normalizePositiveInteger(options.limit, DEFAULT_LIMIT);
  const mediaBeforeStatus = normalizePositiveInteger(
    options.photosBeforeStatus,
    DEFAULT_MEDIA_BEFORE_STATUS
  );
  const maxStatuses = normalizePositiveInteger(
    options.maxStatuses,
    DEFAULT_MAX_STATUSES
  );
  const maxMediaPerOwner = normalizePositiveInteger(
    options.maxMediaPerOwner,
    DEFAULT_MAX_MEDIA_PER_OWNER
  );
  const viewerUid = normalizeUid(options.viewerUid);
  const friendOwners = normalizeUidSet(friendUids ?? []);
  const compatibleOwners = normalizeUidSet([
    ...(compatibleProfiles ?? []).map((profile) => profile.uid),
    ...(options.compatibleOwnerUids ?? []),
  ]);
  const hasPersonalRelationships =
    friendOwners.size > 0 || compatibleOwners.size > 0;

  const normalizedMedia = normalizeMedia(
    photos ?? [],
    options.videos ?? [],
    friendOwners,
    compatibleOwners,
    hasPersonalRelationships,
    maxMediaPerOwner
  );
  const normalizedStatuses = normalizeStatuses(
    statuses ?? [],
    viewerUid,
    friendOwners,
    compatibleOwners
  ).slice(0, maxStatuses);

  if (!normalizedMedia.length) {
    return normalizedStatuses.slice(0, limit);
  }

  const result: ExploreSocialFeedItem[] = [];
  let statusIndex = 0;

  for (let mediaIndex = 0; mediaIndex < normalizedMedia.length; mediaIndex += 1) {
    result.push(normalizedMedia[mediaIndex]);

    const completedMediaGroup = (mediaIndex + 1) % mediaBeforeStatus === 0;
    if (completedMediaGroup && normalizedStatuses[statusIndex]) {
      result.push(normalizedStatuses[statusIndex]);
      statusIndex += 1;
    }

    if (result.length >= limit) {
      return result.slice(0, limit);
    }
  }

  while (statusIndex < normalizedStatuses.length && result.length < limit) {
    result.push(normalizedStatuses[statusIndex]);
    statusIndex += 1;
  }

  return result.slice(0, limit);
}

export function buildExploreSocialFeedWindow(
  items: readonly ExploreSocialFeedItem[] | null | undefined,
  visibleLimit: number
): ExploreSocialFeedWindow {
  const safeItems = [...(items ?? [])];
  const totalItems = safeItems.length;
  const requestedVisibleCount = normalizePositiveInteger(
    visibleLimit,
    DEFAULT_VISIBLE_LIMIT
  );
  const visibleCount = Math.min(totalItems, requestedVisibleCount);
  const remainingItems = Math.max(0, totalItems - visibleCount);

  return {
    items: safeItems.slice(0, visibleCount),
    visibleCount,
    totalItems,
    remainingItems,
    hasMore: remainingItems > 0,
  };
}

function normalizeMedia(
  photos: readonly IPublicPhotoItem[],
  videos: readonly IPublicVideoItem[],
  friendOwners: ReadonlySet<string>,
  compatibleOwners: ReadonlySet<string>,
  restrictToPersonalRelationships: boolean,
  maxMediaPerOwner: number
): ExploreSocialMediaItem[] {
  const unique = new Map<string, ExploreSocialMediaItem>();

  for (const photo of photos) {
    const item = toPhotoFeedItem(photo);
    if (item) unique.set(item.key, item);
  }

  for (const video of videos) {
    const item = toVideoFeedItem(video);
    if (item) unique.set(item.key, item);
  }

  const ranked = [...unique.values()]
    .filter((item) =>
      !restrictToPersonalRelationships ||
      friendOwners.has(item.ownerUid) ||
      compatibleOwners.has(item.ownerUid)
    )
    .sort((left, right) => {
      const relationshipDiff =
        relationshipPriorityForOwner(
          right.ownerUid,
          friendOwners,
          compatibleOwners
        ) -
        relationshipPriorityForOwner(
          left.ownerUid,
          friendOwners,
          compatibleOwners
        );
      if (relationshipDiff !== 0) return relationshipDiff;

      const publishedDiff = right.publishedAt - left.publishedAt;
      if (publishedDiff !== 0) return publishedDiff;

      return left.key.localeCompare(right.key);
    });

  return diversifyMediaByOwnerRounds(ranked, maxMediaPerOwner);
}

function diversifyMediaByOwnerRounds(
  ranked: readonly ExploreSocialMediaItem[],
  maxMediaPerOwner: number
): ExploreSocialMediaItem[] {
  let remaining = [...ranked];
  const result: ExploreSocialMediaItem[] = [];

  while (remaining.length > 0) {
    const ownerCounts = new Map<string, number>();
    const deferred: ExploreSocialMediaItem[] = [];
    let addedThisRound = 0;

    for (const item of remaining) {
      const count = ownerCounts.get(item.ownerUid) ?? 0;

      if (count >= maxMediaPerOwner) {
        deferred.push(item);
        continue;
      }

      ownerCounts.set(item.ownerUid, count + 1);
      result.push(item);
      addedThisRound += 1;
    }

    if (addedThisRound === 0) {
      break;
    }

    remaining = deferred;
  }

  return result;
}

function normalizeStatuses(
  statuses: readonly IUserIntentStatusCardVm[],
  viewerUid: string,
  friendOwners: ReadonlySet<string>,
  compatibleOwners: ReadonlySet<string>
): ExploreSocialStatusItem[] {
  const uniqueByOwner = new Map<string, ExploreSocialStatusItem>();

  for (const status of statuses) {
    const ownerUid = normalizeUid(status?.uid);
    if (!ownerUid || ownerUid === viewerUid || status?.isActive !== true) continue;

    const relationship = resolveRelationship(
      ownerUid,
      friendOwners,
      compatibleOwners
    );
    if (!relationship) continue;

    const id = String(status?.id ?? '').trim();
    if (!id) continue;

    const candidate: ExploreSocialStatusItem = {
      kind: 'status',
      key: `status:${ownerUid}:${id}`,
      ownerUid,
      publishedAt: toFiniteNumber(status.updatedAt ?? status.startsAt),
      relationship,
      status,
    };
    const current = uniqueByOwner.get(ownerUid);

    if (!current || candidate.publishedAt > current.publishedAt) {
      uniqueByOwner.set(ownerUid, candidate);
    }
  }

  return [...uniqueByOwner.values()].sort((left, right) => {
    const relationshipDiff =
      relationshipPriority(right.relationship) -
      relationshipPriority(left.relationship);
    if (relationshipDiff !== 0) return relationshipDiff;

    const publishedDiff = right.publishedAt - left.publishedAt;
    if (publishedDiff !== 0) return publishedDiff;

    return left.key.localeCompare(right.key);
  });
}

function toPhotoFeedItem(
  photo: IPublicPhotoItem | null | undefined
): ExploreSocialPhotoItem | null {
  const ownerUid = normalizeUid(photo?.ownerUid);
  const id = String(photo?.id ?? '').trim();
  if (!photo || !ownerUid || !id) return null;

  return {
    kind: 'photo',
    key: `photo:${ownerUid}:${id}`,
    ownerUid,
    publishedAt: toFiniteNumber(photo.publishedAt),
    photo,
  };
}

function toVideoFeedItem(
  video: IPublicVideoItem | null | undefined
): ExploreSocialVideoItem | null {
  const ownerUid = normalizeUid(video?.ownerUid);
  const id = String(video?.id ?? '').trim();
  if (!video || !ownerUid || !id) return null;

  return {
    kind: 'video',
    key: `video:${ownerUid}:${id}`,
    ownerUid,
    publishedAt: toFiniteNumber(video.publishedAt),
    video,
  };
}

function resolveRelationship(
  ownerUid: string,
  friendOwners: ReadonlySet<string>,
  compatibleOwners: ReadonlySet<string>
): ExploreSocialRelationship | null {
  if (friendOwners.has(ownerUid)) return 'friend';
  if (compatibleOwners.has(ownerUid)) return 'compatible';
  return null;
}

function relationshipPriority(value: ExploreSocialRelationship): number {
  return value === 'friend' ? 2 : 1;
}

function relationshipPriorityForOwner(
  ownerUid: string,
  friendOwners: ReadonlySet<string>,
  compatibleOwners: ReadonlySet<string>
): number {
  if (friendOwners.has(ownerUid)) return 2;
  if (compatibleOwners.has(ownerUid)) return 1;
  return 0;
}

function normalizeUidSet(values: readonly unknown[]): Set<string> {
  return new Set(values.map((value) => normalizeUid(value)).filter(Boolean));
}

function normalizeUid(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toFiniteNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
