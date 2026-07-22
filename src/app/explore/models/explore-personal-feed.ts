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
 * Monta uma timeline pública única sem criar uma segunda fonte de dados.
 *
 * Regras:
 * - combina as seções já autorizadas do Explore;
 * - remove publicações duplicadas;
 * - prioriza autores compatíveis e publicações impulsionadas;
 * - limita repetição por autor para preservar diversidade;
 * - mantém recência e engajamento como critérios secundários.
 */
export function buildExplorePersonalFeed(
  vm: Pick<
    IExploreFeedVm,
    | 'boostedPhotos'
    | 'mostViewedPhotos'
    | 'topPhotos'
    | 'latestPhotos'
    | 'compatibleProfiles'
  >,
  options: ExplorePersonalFeedOptions = {}
): IPublicPhotoItem[] {
  const limit = normalizePositiveInteger(options.limit, DEFAULT_LIMIT);
  const maxItemsPerOwner = normalizePositiveInteger(
    options.maxItemsPerOwner,
    DEFAULT_MAX_ITEMS_PER_OWNER
  );
  const compatibleOwners = new Set(
    (vm.compatibleProfiles ?? [])
      .map((profile: PublicProfileCard) => String(profile.uid ?? '').trim())
      .filter(Boolean)
  );

  const uniqueItems = new Map<string, IPublicPhotoItem>();

  for (const item of [
    ...(vm.boostedPhotos ?? []),
    ...(vm.latestPhotos ?? []),
    ...(vm.topPhotos ?? []),
    ...(vm.mostViewedPhotos ?? []),
  ]) {
    const key = buildPublicationKey(item);
    if (!key || uniqueItems.has(key)) continue;
    uniqueItems.set(key, item);
  }

  const ranked = [...uniqueItems.values()].sort((a, b) => {
    const relevanceDiff =
      calculateRelevanceScore(b, compatibleOwners) -
      calculateRelevanceScore(a, compatibleOwners);

    if (relevanceDiff !== 0) return relevanceDiff;

    const publishedDiff =
      toFiniteNumber(b.publishedAt) - toFiniteNumber(a.publishedAt);
    if (publishedDiff !== 0) return publishedDiff;

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

function calculateRelevanceScore(
  item: IPublicPhotoItem,
  compatibleOwners: ReadonlySet<string>
): number {
  const ownerUid = String(item.ownerUid ?? '').trim();
  const compatibilityBoost = compatibleOwners.has(ownerUid)
    ? 1_000_000_000
    : 0;
  const paidBoost =
    item.boostActive === true
      ? 100_000_000 + toFiniteNumber(item.boostPriority) * 1_000
      : 0;
  const engagement =
    toFiniteNumber(item.engagementScore ?? item.score) * 10_000 +
    toFiniteNumber(item.reactionsCount ?? item.likesCount) * 300 +
    toFiniteNumber(item.commentsCount) * 500 +
    toFiniteNumber(item.viewsCount) * 10;
  const recency = toFiniteNumber(item.publishedAt) / 1_000_000;

  return compatibilityBoost + paidBoost + engagement + recency;
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
