// src/app/community/discovery/community-discovery-cache.model.ts
// -----------------------------------------------------------------------------
// CACHE DE CONTINUIDADE DA DESCOBERTA DE COMUNIDADES
// -----------------------------------------------------------------------------
// Somente dados serializáveis entram no NgRx. A chave inclui o viewer para que
// snapshots de "Minhas" nunca sejam reutilizados entre sessões diferentes.
// -----------------------------------------------------------------------------

import {
  DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE,
  normalizeCommunityDiscoveryPageSize,
} from '../data-access/community-discovery.contract';
import type { CommunityPreviewSourceType } from '../data-access/community-preview.model';
import { normalizeCommunityTagId } from '../data-access/community-tag.model';

export {
  DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE,
  MAX_COMMUNITY_DISCOVERY_PAGE_SIZE,
  MIN_COMMUNITY_DISCOVERY_PAGE_SIZE,
  normalizeCommunityDiscoveryPageSize,
} from '../data-access/community-discovery.contract';

export type CommunityDiscoveryMode = 'explore' | 'mine';

export interface CommunityDiscoveryCacheContext {
  readonly sourceType: CommunityPreviewSourceType;
  readonly discoveryMode: CommunityDiscoveryMode;
  readonly tagId: string | null;
  readonly pageSize: number;
}

export interface CommunityDiscoveryCacheQuery
  extends CommunityDiscoveryCacheContext {
  readonly viewerUid: string;
}

export const COMMUNITY_DISCOVERY_CACHE_TTL_MS = 30_000;

const SAFE_UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const COMMUNITY_DISCOVERY_CACHE_PREFIX = 'community:discovery:v1';

export function normalizeCommunityDiscoveryViewerUid(value: unknown): string {
  const uid = String(value ?? '').trim();
  return SAFE_UID_PATTERN.test(uid) ? uid : '';
}

export function normalizeCommunityDiscoveryCacheContext(
  context: Partial<CommunityDiscoveryCacheContext> | null | undefined
): CommunityDiscoveryCacheContext {
  const sourceType = context?.sourceType === 'venue' ? 'venue' : 'community';
  const discoveryMode =
    sourceType === 'community' && context?.discoveryMode === 'mine'
      ? 'mine'
      : 'explore';
  const tagId =
    sourceType === 'community' && discoveryMode === 'explore'
      ? normalizeCommunityTagId(context?.tagId)
      : null;

  return {
    sourceType,
    discoveryMode,
    tagId,
    pageSize: normalizeCommunityDiscoveryPageSize(context?.pageSize),
  };
}

export function buildCommunityDiscoveryCacheQuery(
  viewerUidValue: unknown,
  context: Partial<CommunityDiscoveryCacheContext> | null | undefined
): CommunityDiscoveryCacheQuery | null {
  const viewerUid = normalizeCommunityDiscoveryViewerUid(viewerUidValue);
  if (!viewerUid) return null;

  return {
    viewerUid,
    ...normalizeCommunityDiscoveryCacheContext(context),
  };
}

export function buildCommunityDiscoveryCacheKey(
  query: CommunityDiscoveryCacheQuery
): string {
  const normalized = buildCommunityDiscoveryCacheQuery(query.viewerUid, query);

  if (!normalized) {
    return `${COMMUNITY_DISCOVERY_CACHE_PREFIX}|viewer=invalid`;
  }

  return [
    COMMUNITY_DISCOVERY_CACHE_PREFIX,
    `viewer=${normalized.viewerUid}`,
    `source=${normalized.sourceType}`,
    `mode=${normalized.discoveryMode}`,
    `tag=${normalized.tagId ?? 'all'}`,
    `size=${normalized.pageSize}`,
  ].join('|');
}
