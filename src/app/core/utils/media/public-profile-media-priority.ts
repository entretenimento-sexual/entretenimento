import {
  IPublicProfileMediaItem,
  isPublicPhotoItem,
  isPublicVideoItem,
} from 'src/app/core/interfaces/media/i-public-profile-media-item';
import { buildPublicMediaIdentity } from './public-media-identity';

export interface PublicProfileMediaPriorityOptions {
  readonly connectionOwnerUids?: readonly string[];
  readonly compatibleOwnerUids?: readonly string[];
  readonly recentViewedKeys?: readonly string[];
  readonly limit?: number;
  /**
   * Diversidade suave. Quando definido, tenta evitar sequências maiores do que
   * este valor sem ultrapassar prioridade social nem novidade.
   */
  readonly maxConsecutiveSameType?: number | null;
}

interface PersonalizedSlotState {
  value: number;
}

function mediaKey(item: IPublicProfileMediaItem): string {
  return buildPublicMediaIdentity(
    isPublicVideoItem(item) ? 'VIDEO' : 'PHOTO',
    item.ownerUid,
    item.id
  );
}

function mediaOwnerUid(item: IPublicProfileMediaItem): string {
  return String(item.ownerUid ?? '').trim();
}

function mediaPublishedAt(item: IPublicProfileMediaItem): number {
  const value = Number(item.publishedAt ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function mediaType(item: IPublicProfileMediaItem): 'PHOTO' | 'VIDEO' {
  return isPublicVideoItem(item) ? 'VIDEO' : 'PHOTO';
}

function normalizeItems(
  input: readonly IPublicProfileMediaItem[]
): IPublicProfileMediaItem[] {
  const unique = new Map<string, IPublicProfileMediaItem>();

  for (const item of input ?? []) {
    if (!item) continue;

    const key = mediaKey(item);
    if (!key) continue;

    if (isPublicPhotoItem(item) && !String(item.url ?? '').trim()) {
      continue;
    }

    unique.set(key, item);
  }

  return [...unique.values()];
}

function normalizeOwnerUids(values: readonly string[] | undefined): string[] {
  const unique = new Set<string>();

  for (const value of values ?? []) {
    const uid = String(value ?? '').trim();
    if (uid) unique.add(uid);
  }

  return [...unique];
}

function normalizeLimit(value: number | undefined, available: number): number {
  const parsed = Number(value ?? available);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return available;
  }

  return Math.min(available, Math.max(1, Math.trunc(parsed)));
}

function normalizeMaxConsecutive(value: number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.max(1, Math.trunc(parsed))
    : null;
}

function sortByPublishedAt(
  items: readonly IPublicProfileMediaItem[]
): IPublicProfileMediaItem[] {
  return [...items].sort((left, right) => {
    const publishedAtDelta = mediaPublishedAt(right) - mediaPublishedAt(left);
    if (publishedAtDelta !== 0) {
      return publishedAtDelta;
    }

    return mediaKey(left).localeCompare(mediaKey(right));
  });
}

function shouldPreferOppositeType(
  result: readonly IPublicProfileMediaItem[],
  maxConsecutiveSameType: number | null
): 'PHOTO' | 'VIDEO' | null {
  if (!maxConsecutiveSameType || result.length < maxConsecutiveSameType) {
    return null;
  }

  const last = result[result.length - 1];
  if (!last) return null;

  const lastType = mediaType(last);
  let consecutive = 1;

  for (
    let index = result.length - 2;
    index >= 0 && consecutive < maxConsecutiveSameType;
    index -= 1
  ) {
    if (mediaType(result[index]) !== lastType) break;
    consecutive += 1;
  }

  if (consecutive < maxConsecutiveSameType) {
    return null;
  }

  return lastType === 'VIDEO' ? 'PHOTO' : 'VIDEO';
}

function takeNextCandidate(
  bucket: IPublicProfileMediaItem[],
  result: readonly IPublicProfileMediaItem[],
  maxConsecutiveSameType: number | null
): IPublicProfileMediaItem | null {
  if (!bucket.length) {
    return null;
  }

  const preferredType = shouldPreferOppositeType(
    result,
    maxConsecutiveSameType
  );

  if (preferredType) {
    const preferredIndex = bucket.findIndex(
      (item) => mediaType(item) === preferredType
    );

    if (preferredIndex >= 0) {
      return bucket.splice(preferredIndex, 1)[0] ?? null;
    }
  }

  return bucket.shift() ?? null;
}

function pushNextCandidate(
  result: IPublicProfileMediaItem[],
  bucket: IPublicProfileMediaItem[],
  maxConsecutiveSameType: number | null
): boolean {
  const candidate = takeNextCandidate(
    bucket,
    result,
    maxConsecutiveSameType
  );

  if (!candidate) {
    return false;
  }

  result.push(candidate);
  return true;
}

function appendPersonalized(
  result: IPublicProfileMediaItem[],
  connectionItems: IPublicProfileMediaItem[],
  compatibleItems: IPublicProfileMediaItem[],
  limit: number,
  maxConsecutiveSameType: number | null,
  personalizedSlotState: PersonalizedSlotState
): void {
  while (
    result.length < limit &&
    (connectionItems.length > 0 || compatibleItems.length > 0)
  ) {
    const preferConnection = personalizedSlotState.value % 2 === 0;
    const primary = preferConnection ? connectionItems : compatibleItems;
    const fallback = preferConnection ? compatibleItems : connectionItems;

    if (!pushNextCandidate(result, primary, maxConsecutiveSameType)) {
      pushNextCandidate(result, fallback, maxConsecutiveSameType);
    }

    personalizedSlotState.value += 1;
  }
}

function appendNoveltyTier(
  result: IPublicProfileMediaItem[],
  tierItems: readonly IPublicProfileMediaItem[],
  connectionOwners: ReadonlySet<string>,
  compatibleOwners: ReadonlySet<string>,
  limit: number,
  maxConsecutiveSameType: number | null,
  personalizedSlotState: PersonalizedSlotState
): void {
  if (!tierItems.length || result.length >= limit) {
    return;
  }

  const sorted = sortByPublishedAt(tierItems);
  const connectionBucket = sorted.filter((item) =>
    connectionOwners.has(mediaOwnerUid(item))
  );
  const compatibleBucket = sorted.filter((item) =>
    compatibleOwners.has(mediaOwnerUid(item))
  );
  const globalBucket = sorted.filter((item) => {
    const ownerUid = mediaOwnerUid(item);
    return !connectionOwners.has(ownerUid) && !compatibleOwners.has(ownerUid);
  });

  if (!connectionBucket.length && !compatibleBucket.length) {
    while (result.length < limit && globalBucket.length > 0) {
      pushNextCandidate(result, globalBucket, maxConsecutiveSameType);
    }
    return;
  }

  if (!globalBucket.length) {
    appendPersonalized(
      result,
      connectionBucket,
      compatibleBucket,
      limit,
      maxConsecutiveSameType,
      personalizedSlotState
    );
    return;
  }

  while (result.length < limit) {
    const hasConnection = connectionBucket.length > 0;
    const hasCompatible = compatibleBucket.length > 0;
    const hasGlobal = globalBucket.length > 0;

    if (!hasConnection && !hasCompatible && !hasGlobal) {
      break;
    }

    const personalizedSlot =
      result.length % 3 === 0 && (hasConnection || hasCompatible);

    if (personalizedSlot) {
      const preferConnection = personalizedSlotState.value % 2 === 0;
      const primary = preferConnection ? connectionBucket : compatibleBucket;
      const fallback = preferConnection ? compatibleBucket : connectionBucket;

      if (!pushNextCandidate(result, primary, maxConsecutiveSameType)) {
        pushNextCandidate(result, fallback, maxConsecutiveSameType);
      }

      personalizedSlotState.value += 1;
      continue;
    }

    if (hasGlobal) {
      pushNextCandidate(result, globalBucket, maxConsecutiveSameType);
      continue;
    }

    appendPersonalized(
      result,
      connectionBucket,
      compatibleBucket,
      limit,
      maxConsecutiveSameType,
      personalizedSlotState
    );
    break;
  }
}

/**
 * Composição canônica de mídia pública de perfil.
 *
 * Regras:
 * - deduplica por tipo + ownerUid + mediaId;
 * - toda mídia não vista recentemente precede mídia já vista, sem removê-la;
 * - dentro do mesmo nível de novidade, preserva publicação mais recente;
 * - enquanto houver mídia global no nível atual, conexão/compatível ocupa no
 *   máximo um slot a cada três mídias;
 * - conexão e compatível alternam a preferência dos slots personalizados;
 * - diversidade de PHOTO/VIDEO é opcional, nunca atravessa níveis de novidade
 *   e nunca cria slot social extra.
 */
export function composePublicProfileMediaPriority(
  input: readonly IPublicProfileMediaItem[],
  options: PublicProfileMediaPriorityOptions = {}
): IPublicProfileMediaItem[] {
  const normalized = normalizeItems(input);
  if (!normalized.length) {
    return [];
  }

  const limit = normalizeLimit(options.limit, normalized.length);
  const maxConsecutiveSameType = normalizeMaxConsecutive(
    options.maxConsecutiveSameType
  );
  const recentViewedKeys = new Set(options.recentViewedKeys ?? []);
  const connectionOwners = new Set(
    normalizeOwnerUids(options.connectionOwnerUids)
  );
  const compatibleOwners = new Set(
    normalizeOwnerUids(options.compatibleOwnerUids)
      .filter((uid) => !connectionOwners.has(uid))
  );
  const unseenItems = normalized.filter(
    (item) => !recentViewedKeys.has(mediaKey(item))
  );
  const seenItems = normalized.filter(
    (item) => recentViewedKeys.has(mediaKey(item))
  );
  const result: IPublicProfileMediaItem[] = [];
  const personalizedSlotState: PersonalizedSlotState = { value: 0 };

  appendNoveltyTier(
    result,
    unseenItems,
    connectionOwners,
    compatibleOwners,
    limit,
    maxConsecutiveSameType,
    personalizedSlotState
  );

  appendNoveltyTier(
    result,
    seenItems,
    connectionOwners,
    compatibleOwners,
    limit,
    maxConsecutiveSameType,
    personalizedSlotState
  );

  return result.slice(0, limit);
}
