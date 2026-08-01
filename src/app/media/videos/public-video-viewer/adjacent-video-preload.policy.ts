import type { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';

export type TAdjacentVideoNavigationDirection = 'next' | 'previous';

export interface AdjacentVideoPreloadEnvironment {
  readonly isBrowser: boolean;
  readonly online: boolean;
  readonly visibilityState: string;
  readonly saveData: boolean;
  readonly effectiveType: string | null;
  readonly downlinkMbps: number | null;
}

const BLOCKED_EFFECTIVE_TYPES = new Set(['slow-2g', '2g']);
const MIN_DOWNLINK_MBPS = 1.5;
const MIN_ACCESS_VALIDITY_MS = 45_000;

export function canPreloadAdjacentVideoMetadata(
  environment: AdjacentVideoPreloadEnvironment
): boolean {
  if (
    !environment.isBrowser ||
    !environment.online ||
    environment.visibilityState !== 'visible' ||
    environment.saveData
  ) {
    return false;
  }

  const effectiveType = String(environment.effectiveType ?? '')
    .trim()
    .toLowerCase();

  if (BLOCKED_EFFECTIVE_TYPES.has(effectiveType)) {
    return false;
  }

  const downlinkMbps = Number(environment.downlinkMbps);

  return !Number.isFinite(downlinkMbps) ||
    downlinkMbps <= 0 ||
    downlinkMbps >= MIN_DOWNLINK_MBPS;
}

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
