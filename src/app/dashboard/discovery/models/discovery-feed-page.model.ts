// src/app/dashboard/discovery/models/discovery-feed-page.model.ts
// -----------------------------------------------------------------------------
// Contratos serializáveis da Discovery V2.
//
// Regras:
// - nenhum QueryDocumentSnapshot/Timestamp entra no NgRx;
// - cursor usa epoch + uid para paginação determinística;
// - chave de consulta inclui usuário, modo e tamanho da página;
// - chave de cache inclui também o cursor da página;
// - o prefixo pertence à política sensível já removida no logout.
// -----------------------------------------------------------------------------

import { DiscoveryMode } from './discovery-mode.model';
import { PublicProfileCard } from './public-profile-card.model';

export type PagedDiscoveryMode = Extract<DiscoveryMode, 'all' | 'compatible'>;
export type DiscoveryPageSource = 'cache' | 'server';

export interface DiscoveryFeedCursor {
  readonly updatedAtMs: number;
  readonly uid: string;
}

export interface DiscoveryFeedRequest {
  readonly viewerUid: string;
  readonly mode: PagedDiscoveryMode;
  readonly pageSize: number;
}

export interface DiscoveryFeedPage {
  readonly items: readonly PublicProfileCard[];
  readonly nextCursor: DiscoveryFeedCursor | null;
  readonly reachedEnd: boolean;
  readonly source: DiscoveryPageSource;
  readonly fetchedAt: number;
}

export interface CachedDiscoveryFeedPage {
  readonly items: readonly PublicProfileCard[];
  readonly nextCursor: DiscoveryFeedCursor | null;
  readonly reachedEnd: boolean;
  readonly fetchedAt: number;
}

export const DEFAULT_DISCOVERY_PAGE_SIZE = 24;
export const MIN_DISCOVERY_PAGE_SIZE = 6;
export const MAX_DISCOVERY_PAGE_SIZE = 48;

const DISCOVERY_CACHE_PREFIX = 'discovery:public_profiles:uids:v2';

export function normalizeDiscoveryViewerUid(value: unknown): string {
  const uid = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(uid) ? uid : '';
}

export function normalizeDiscoveryPageSize(value: unknown): number {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed)
    ? Math.trunc(parsed)
    : DEFAULT_DISCOVERY_PAGE_SIZE;

  return Math.min(
    MAX_DISCOVERY_PAGE_SIZE,
    Math.max(MIN_DISCOVERY_PAGE_SIZE, normalized)
  );
}

export function normalizeDiscoveryRequest(
  request: Partial<DiscoveryFeedRequest> | null | undefined
): DiscoveryFeedRequest | null {
  const viewerUid = normalizeDiscoveryViewerUid(request?.viewerUid);
  const mode = request?.mode === 'compatible' ? 'compatible' : 'all';

  if (!viewerUid) {
    return null;
  }

  return {
    viewerUid,
    mode,
    pageSize: normalizeDiscoveryPageSize(request?.pageSize),
  };
}

export function normalizeDiscoveryCursor(
  cursor: DiscoveryFeedCursor | null | undefined
): DiscoveryFeedCursor | null {
  if (!cursor) {
    return null;
  }

  const uid = normalizeDiscoveryViewerUid(cursor.uid);
  const updatedAtMs = Number(cursor.updatedAtMs);

  if (!uid || !Number.isFinite(updatedAtMs) || updatedAtMs <= 0) {
    return null;
  }

  return {
    uid,
    updatedAtMs: Math.trunc(updatedAtMs),
  };
}

export function buildDiscoveryFeedQueryKey(
  request: DiscoveryFeedRequest
): string {
  const normalized = normalizeDiscoveryRequest(request);

  if (!normalized) {
    return `${DISCOVERY_CACHE_PREFIX}:invalid`;
  }

  return [
    DISCOVERY_CACHE_PREFIX,
    `viewer=${normalized.viewerUid}`,
    `mode=${normalized.mode}`,
    `size=${normalized.pageSize}`,
  ].join('|');
}

export function buildDiscoveryFeedPageCacheKey(
  request: DiscoveryFeedRequest,
  cursor: DiscoveryFeedCursor | null | undefined
): string {
  const queryKey = buildDiscoveryFeedQueryKey(request);
  const normalizedCursor = normalizeDiscoveryCursor(cursor);
  const cursorKey = normalizedCursor
    ? `${normalizedCursor.updatedAtMs}:${normalizedCursor.uid}`
    : 'first';

  return `${queryKey}|cursor=${cursorKey}`;
}
