import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';

export type TAdjacentVideoNavigationDirection = 'next' | 'previous';

const MIN_ACCESS_VALIDITY_MS = 45_000;

export function selectAdjacentVideoForPreload(
  items: readonly IPublicVideoItem[],
  currentIndex: number,
  direction: TAdjacentVideoNavigationDirection,
  now = Date.now()
): IPublicVideoItem | null {
  if (!items.length || currentIndex < 0 || currentIndex >= items.length) {
    return null;
  }

  const preferredOffset = direction === 'previous' ? -1 : 1;
  const candidateIndexes = [
    currentIndex + preferredOffset,
    currentIndex - preferredOffset,
  ];

  for (const candidateIndex of candidateIndexes) {
    const candidate = items[candidateIndex];

    if (isPreloadCandidateUsable(candidate, now)) {
      return candidate;
    }
  }

  return null;
}

function isPreloadCandidateUsable(
  candidate: IPublicVideoItem | null | undefined,
  now: number
): candidate is IPublicVideoItem {
  if (!candidate?.url?.trim()) {
    return false;
  }

  const accessExpiresAt = Number(candidate.accessExpiresAt ?? 0);

  return Number.isFinite(accessExpiresAt) &&
    accessExpiresAt > now + MIN_ACCESS_VALIDITY_MS;
}
