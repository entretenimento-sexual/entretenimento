import type { IUserIntentStatusCardVm } from 'src/app/core/interfaces/discovery/user-intent-status.interface';
import type { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import type { PublicProfileCard } from 'src/app/dashboard/discovery/models/public-profile-card.model';

export type ExploreSocialRelationship = 'friend' | 'compatible';

export interface ExploreSocialPhotoItem {
  readonly kind: 'photo';
  readonly key: string;
  readonly ownerUid: string;
  readonly publishedAt: number;
  readonly photo: IPublicPhotoItem;
}

export interface ExploreSocialStatusItem {
  readonly kind: 'status';
  readonly key: string;
  readonly ownerUid: string;
  readonly publishedAt: number;
  readonly relationship: ExploreSocialRelationship;
  readonly status: IUserIntentStatusCardVm;
}

export type ExploreSocialFeedItem =
  | ExploreSocialPhotoItem
  | ExploreSocialStatusItem;

export interface ExploreSocialFeedOptions {
  readonly limit?: number;
  readonly photosBeforeStatus?: number;
  readonly maxStatuses?: number;
  readonly viewerUid?: string | null;
}

export interface ExploreSocialFeedWindow {
  readonly items: readonly ExploreSocialFeedItem[];
  readonly visibleCount: number;
  readonly totalItems: number;
  readonly remainingItems: number;
  readonly hasMore: boolean;
}

const DEFAULT_LIMIT = 36;
const DEFAULT_PHOTOS_BEFORE_STATUS = 2;
const DEFAULT_MAX_STATUSES = 4;
const DEFAULT_VISIBLE_LIMIT = 6;

/**
 * Intercala momentos temporários na timeline pessoal sem fazê-los competir com
 * o compositor persistente.
 *
 * Contrato:
 * - fotos já chegam ordenadas pela relação pessoal e recência;
 * - somente momentos ativos de amigos ou perfis compatíveis entram;
 * - o próprio usuário é excluído porque o seu momento ocupa o primeiro cartão;
 * - no máximo um momento por autor e um momento a cada duas fotos;
 * - quando não há fotos, os momentos relacionados ainda podem preencher o feed.
 */
export function buildExploreSocialFeed(
  photos: readonly IPublicPhotoItem[] | null | undefined,
  statuses: readonly IUserIntentStatusCardVm[] | null | undefined,
  friendUids: readonly string[] | null | undefined,
  compatibleProfiles: readonly PublicProfileCard[] | null | undefined,
  options: ExploreSocialFeedOptions = {}
): ExploreSocialFeedItem[] {
  const limit = normalizePositiveInteger(options.limit, DEFAULT_LIMIT);
  const photosBeforeStatus = normalizePositiveInteger(
    options.photosBeforeStatus,
    DEFAULT_PHOTOS_BEFORE_STATUS
  );
  const maxStatuses = normalizePositiveInteger(
    options.maxStatuses,
    DEFAULT_MAX_STATUSES
  );
  const viewerUid = normalizeUid(options.viewerUid);
  const friendOwners = normalizeUidSet(friendUids ?? []);
  const compatibleOwners = normalizeUidSet(
    (compatibleProfiles ?? []).map((profile) => profile.uid)
  );

  const normalizedPhotos = (photos ?? [])
    .map((photo) => toPhotoFeedItem(photo))
    .filter((item): item is ExploreSocialPhotoItem => !!item);
  const normalizedStatuses = normalizeStatuses(
    statuses ?? [],
    viewerUid,
    friendOwners,
    compatibleOwners
  ).slice(0, maxStatuses);

  if (!normalizedPhotos.length) {
    return normalizedStatuses.slice(0, limit);
  }

  const result: ExploreSocialFeedItem[] = [];
  let statusIndex = 0;

  for (let photoIndex = 0; photoIndex < normalizedPhotos.length; photoIndex += 1) {
    result.push(normalizedPhotos[photoIndex]);

    const completedPhotoGroup = (photoIndex + 1) % photosBeforeStatus === 0;
    if (completedPhotoGroup && normalizedStatuses[statusIndex]) {
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
