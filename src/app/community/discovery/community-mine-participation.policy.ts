// src/app/community/discovery/community-mine-participation.policy.ts
import type { CommunityPreviewViewerRole } from '../data-access/community-preview.model';

export type CommunityMineParticipationFilter =
  | 'all'
  | 'managed'
  | 'member'
  | 'muted';

export interface CommunityMineParticipationItem {
  readonly name: string;
  readonly viewerRole?: CommunityPreviewViewerRole | null;
  readonly notificationsMuted: boolean;
}

export const COMMUNITY_MINE_SEARCH_THRESHOLD = 8;

function normalizeSearchText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export function isManagedCommunityRole(
  role: CommunityPreviewViewerRole | null | undefined
): boolean {
  return role === 'owner' || role === 'admin' || role === 'moderator';
}

export function shouldShowMineCommunitySearch(
  loadedCount: number,
  currentQuery: unknown
): boolean {
  const count = Math.max(0, Math.trunc(Number(loadedCount) || 0));
  return count >= COMMUNITY_MINE_SEARCH_THRESHOLD
    || normalizeSearchText(currentQuery).length > 0;
}

export function filterMineCommunityItems<
  T extends CommunityMineParticipationItem,
>(
  items: readonly T[],
  filter: CommunityMineParticipationFilter,
  searchTerm: unknown
): readonly T[] {
  const normalizedQuery = normalizeSearchText(searchTerm);

  return items.filter((item) => {
    if (
      filter === 'managed'
      && !isManagedCommunityRole(item.viewerRole)
    ) {
      return false;
    }

    if (filter === 'member' && item.viewerRole !== 'member') {
      return false;
    }

    if (filter === 'muted' && !item.notificationsMuted) {
      return false;
    }

    return normalizedQuery.length === 0
      || normalizeSearchText(item.name).includes(normalizedQuery);
  });
}
