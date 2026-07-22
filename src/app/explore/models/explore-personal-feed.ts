import type { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import type { PublicProfileCard } from 'src/app/dashboard/discovery/models/public-profile-card.model';
import type { IExploreFeedVm } from '../services/explore-feed.service';

export interface ExplorePersonalFeedOptions {
  readonly limit?: number;
  readonly maxItemsPerOwner?: number;
}

export interface ExplorePersonalFeedWindow {
  readonly items: readonly IPublicPhotoItem[];
  readonly visibleCount: number;
  readonly totalItems: number;
  readonly remainingItems: number;
  readonly hasMore: boolean;
}

const DEFAULT_LIMIT = 18;
const DEFAULT_MAX_ITEMS_PER_OWNER = 2;
const DEFAULT_VISIBLE_LIMIT = 6;

/**
 * Monta a timeline pessoal da área Descobrir.
 *
 * Ordem canônica:
 * 1. publicações recentes de amigos;
 * 2. publicações recentes de perfis compatíveis;
 * 3. fallback público somente quando nenhuma relação pessoal foi resolvida.
 *
 * Conteúdo impulsionado e engajamento nunca ultrapassam o vínculo pessoal.
 */
export function buildExplorePersonalFeed(
  vm: Pick<
    IExploreFeedVm,
    | 'boostedPhotos'
    | 'mostViewedPhotos'
    | 'topPhotos'
    | 'latestPhotos'
    | 'personalPhotos'
    | 'compatibleProfiles'
    | 'friendUids'
  >,
  options: ExplorePersonalFeedOptions = {}
): IPublicPhotoItem[] {
  const limit = normalizePositiveInteger(options.limit, DEFAULT_LIMIT);
  const maxItemsPerOwner = normalizePositiveInteger(
    options.maxItemsPerOwner,
    DEFAULT_MAX_ITEMS_PER_OWNER
  );
  const friendOwners = normalizeUidSet(vm.friendUids ?? []);
  const compatibleOwners = normalizeUidSet(
    (vm.compatibleProfiles ?? []).map(
      (profile: PublicProfileCard) => profile.uid
    )
  );
  const personalizedOwners = new Set([
    ...friendOwners,
    ...compatibleOwners,
  ]);

  const uniqueItems = new Map<string, IPublicPhotoItem>();

  for (const item of [
    ...(vm.personalPhotos ?? []),
    ...(vm.latestPhotos ?? []),
    ...(vm.boostedPhotos ?? []),
    ...(vm.topPhotos ?? []),
    ...(vm.mostViewedPhotos ?? []),
  ]) {
    const key = buildPublicationKey(item);
    const ownerUid = String(item?.ownerUid ?? '').trim();

    if (!key || uniqueItems.has(key)) continue;
    if (personalizedOwners.size > 0 && !personalizedOwners.has(ownerUid)) {
      continue;
    }

    uniqueItems.set(key, item);
  }

  const ranked = [...uniqueItems.values()].sort((a, b) => {
    const relationshipDiff =
      relationshipPriority(b.ownerUid, friendOwners, compatibleOwners) -
      relationshipPriority(a.ownerUid, friendOwners, compatibleOwners);

    if (relationshipDiff !== 0) return relationshipDiff;

    const publishedDiff =
      toFiniteNumber(b.publishedAt) - toFiniteNumber(a.publishedAt);

    if (publishedDiff !== 0) return publishedDiff;

    const relevanceDiff = calculateSecondaryScore(b) - calculateSecondaryScore(a);
    if (relevanceDiff !== 0) return relevanceDiff;

    return buildPublicationKey(a).localeCompare(buildPublicationKey(b));
  });

  const ownerCounts = new Map<string, number>();
  const feed: IPublicPhotoItem[] = [];

  for (const item of ranked) {
    const ownerUid = String(item.ownerUid ?? '').trim() || 'unknown-owner';
    const count = ownerCounts.get(ownerUid) ?? 0;

    if (count >= maxItemsPerOwner) continue;

    ownerCounts.set(ownerUid, count + 1);
    feed.push(item);

    if (feed.length >= limit) break;
  }

  return feed;
}

/**
 * Projeta uma janela incremental sobre a timeline já autorizada.
 *
 * O helper não dispara nova consulta nem cria uma segunda paginação de backend.
 * Ele reduz a quantidade de cards montados inicialmente e mantém a expansão sob
 * controle explícito do usuário, o que favorece mobile, acessibilidade e debug.
 */
export function buildExplorePersonalFeedWindow(
  items: readonly IPublicPhotoItem[] | null | undefined,
  visibleLimit: number
): ExplorePersonalFeedWindow {
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

function relationshipPriority(
  ownerUid: unknown,
  friendOwners: ReadonlySet<string>,
  compatibleOwners: ReadonlySet<string>
): number {
  const normalized = String(ownerUid ?? '').trim();
  if (friendOwners.has(normalized)) return 2;
  if (compatibleOwners.has(normalized)) return 1;
  return 0;
}

function calculateSecondaryScore(item: IPublicPhotoItem): number {
  const paidBoost = item.boostActive === true
    ? 1_000_000 + toFiniteNumber(item.boostPriority) * 1_000
    : 0;
  const engagement =
    toFiniteNumber(item.engagementScore ?? item.score) * 10_000 +
    toFiniteNumber(item.reactionsCount ?? item.likesCount) * 300 +
    toFiniteNumber(item.commentsCount) * 500 +
    toFiniteNumber(item.viewsCount) * 10;

  return paidBoost + engagement;
}

function normalizeUidSet(values: readonly unknown[]): Set<string> {
  return new Set(
    values
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
  );
}

function buildPublicationKey(item: IPublicPhotoItem): string {
  const ownerUid = String(item.ownerUid ?? '').trim();
  const id = String(item.id ?? '').trim();
  return ownerUid && id ? `${ownerUid}:${id}` : '';
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toFiniteNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
