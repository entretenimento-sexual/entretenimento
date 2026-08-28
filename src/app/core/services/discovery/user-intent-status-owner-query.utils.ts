import type { IUserIntentStatusCardVm } from 'src/app/core/interfaces/discovery/user-intent-status.interface';

export const USER_INTENT_STATUS_OWNER_FILTER_CHUNK_SIZE = 30;

export function normalizeUserIntentStatusOwnerUids(
  values: readonly string[]
): string[] {
  const unique = new Set<string>();

  for (const value of values ?? []) {
    const uid = String(value ?? '').trim();
    if (uid) {
      unique.add(uid);
    }
  }

  return [...unique];
}

export function chunkUserIntentStatusOwnerUids(
  values: readonly string[],
  chunkSize = USER_INTENT_STATUS_OWNER_FILTER_CHUNK_SIZE
): string[][] {
  const normalized = normalizeUserIntentStatusOwnerUids(values);
  const safeChunkSize = Math.max(Math.trunc(chunkSize || 0), 1);
  const chunks: string[][] = [];

  for (let index = 0; index < normalized.length; index += safeChunkSize) {
    chunks.push(normalized.slice(index, index + safeChunkSize));
  }

  return chunks;
}

export function mergeUserIntentStatusCardPages(
  pages: readonly (readonly IUserIntentStatusCardVm[])[],
  limit: number
): IUserIntentStatusCardVm[] {
  const safeLimit = Math.max(Math.trunc(limit || 0), 0);
  if (safeLimit === 0) {
    return [];
  }

  const byId = new Map<string, IUserIntentStatusCardVm>();

  for (const page of pages ?? []) {
    for (const status of page ?? []) {
      const id = String(status?.id ?? '').trim();
      const uid = String(status?.uid ?? '').trim();
      const key = id || uid;

      if (!key || byId.has(key)) {
        continue;
      }

      byId.set(key, status);
    }
  }

  return [...byId.values()]
    .sort((left, right) =>
      (left.expiresAt - right.expiresAt) ||
      (right.startsAt - left.startsAt) ||
      String(left.uid ?? '').localeCompare(String(right.uid ?? '')) ||
      String(left.id ?? '').localeCompare(String(right.id ?? ''))
    )
    .slice(0, safeLimit);
}
