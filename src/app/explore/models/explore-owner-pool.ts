export interface ExploreOwnerBatchOptions {
  readonly batchSize?: number;
  readonly preferredFriendCount?: number;
}

const DEFAULT_BATCH_SIZE = 12;
const DEFAULT_PREFERRED_FRIEND_COUNT = 8;

/**
 * Seleciona o próximo lote de autores sem repetir quem já foi consultado.
 *
 * Ordem de preenchimento:
 * 1. amigos até a cota preferencial;
 * 2. compatíveis até completar o lote;
 * 3. amigos excedentes, caso ainda exista espaço.
 *
 * Dessa forma o feed preserva prioridade social sem impedir rotação de perfis
 * compatíveis quando eles existem.
 */
export function buildNextExploreOwnerBatch(
  friendUids: readonly string[] | null | undefined,
  compatibleUids: readonly string[] | null | undefined,
  usedOwnerUids: readonly string[] | ReadonlySet<string> | null | undefined,
  options: ExploreOwnerBatchOptions = {}
): string[] {
  const batchSize = normalizePositiveInteger(
    options.batchSize,
    DEFAULT_BATCH_SIZE
  );
  const preferredFriendCount = Math.min(
    batchSize,
    normalizePositiveInteger(
      options.preferredFriendCount,
      DEFAULT_PREFERRED_FRIEND_COUNT
    )
  );
  const used = normalizeUidSet(
    usedOwnerUids ? [...usedOwnerUids] : []
  );
  const friends = normalizeUidList(friendUids ?? []).filter(
    (uid) => !used.has(uid)
  );
  const compatibles = normalizeUidList(compatibleUids ?? []).filter(
    (uid) => !used.has(uid)
  );
  const selected: string[] = [];
  const selectedSet = new Set<string>();

  appendUntil(
    selected,
    selectedSet,
    friends,
    Math.min(batchSize, preferredFriendCount)
  );
  appendUntil(selected, selectedSet, compatibles, batchSize);
  appendUntil(selected, selectedSet, friends, batchSize);

  return selected;
}

export function hasUnusedExploreOwners(
  friendUids: readonly string[] | null | undefined,
  compatibleUids: readonly string[] | null | undefined,
  usedOwnerUids: readonly string[] | ReadonlySet<string> | null | undefined
): boolean {
  return buildNextExploreOwnerBatch(
    friendUids,
    compatibleUids,
    usedOwnerUids,
    { batchSize: 1, preferredFriendCount: 1 }
  ).length > 0;
}

function appendUntil(
  target: string[],
  targetSet: Set<string>,
  candidates: readonly string[],
  limit: number
): void {
  for (const uid of candidates) {
    if (target.length >= limit) {
      return;
    }

    if (targetSet.has(uid)) {
      continue;
    }

    targetSet.add(uid);
    target.push(uid);
  }
}

function normalizeUidList(values: readonly unknown[]): string[] {
  const unique = new Set<string>();

  for (const value of values) {
    const uid = normalizeUid(value);
    if (uid) unique.add(uid);
  }

  return [...unique];
}

function normalizeUidSet(values: readonly unknown[]): Set<string> {
  return new Set(normalizeUidList(values));
}

function normalizeUid(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
