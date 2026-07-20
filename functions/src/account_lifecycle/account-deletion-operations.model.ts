// functions/src/account_lifecycle/account-deletion-operations.model.ts
// -----------------------------------------------------------------------------
// ADMIN ACCOUNT DELETION OPERATIONS MODEL
// -----------------------------------------------------------------------------
// Normaliza filtros e transforma tombstones em uma projeção administrativa
// sanitizada. UIDs, hashes de e-mail e payloads brutos nunca saem desta camada.
// -----------------------------------------------------------------------------
import { buildPurgeCandidateReference } from './account-deletion-purge.policy';
import type { AccountDataDomain } from './account-data-retention.policy';

export type AccountDeletionOperationFilter =
  | 'attention'
  | 'in_progress'
  | 'blocked'
  | 'retry_scheduled'
  | 'completed'
  | 'all';

export type AccountDeletionOperationStatus =
  | 'in_progress'
  | 'blocked'
  | 'retry_scheduled'
  | 'completed'
  | 'pending';

export interface AccountDeletionOperationsCursor {
  updatedAt: number;
  reference: string;
}

export interface NormalizedAccountDeletionOperationsRequest {
  filter: AccountDeletionOperationFilter;
  limit: number;
  cursor: AccountDeletionOperationsCursor | null;
}

export interface AccountDeletionOperationItem {
  reference: string;
  status: AccountDeletionOperationStatus;
  phase: string;
  source: 'self' | 'moderator' | 'system' | 'unknown';
  attemptCount: number;
  policyVersion: number | null;
  authDeletionStatus: string;
  firestoreDeletionStatus: string;
  dataDeletionStatus: string;
  completedDomainCount: number;
  blockingDomains: AccountDataDomain[];
  nextAttemptAt: number | null;
  retryDelayMs: number | null;
  leaseUntil: number | null;
  lastErrorCode: string | null;
  lastErrorCategory: string | null;
  lastErrorPhase: string | null;
  deletionRequestedAt: number | null;
  deletedAt: number | null;
  purgeAfter: number | null;
  updatedAt: number;
}

const ALLOWED_FILTERS = new Set<AccountDeletionOperationFilter>([
  'attention',
  'in_progress',
  'blocked',
  'retry_scheduled',
  'completed',
  'all',
]);

const ALLOWED_DOMAINS = new Set<AccountDataDomain>([
  'public_profile',
  'nickname_index',
  'auth_identity',
  'notifications',
  'preferences',
  'presence_and_location',
  'relationship_edges',
  'friend_requests',
  'community_memberships',
  'room_participation',
  'owned_media_and_storage',
  'shared_messages',
  'shared_publications',
  'moderation_reports_and_evidence',
  'financial_records_and_entitlements',
  'private_user_document',
  'lifecycle_and_security_audit',
]);

const IN_PROGRESS_PHASES = new Set([
  'claimed',
  'auth_deletion',
  'data_cleanup',
  'finalization',
]);

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_BLOCKING_DOMAINS = 20;

export function normalizeAccountDeletionOperationsRequest(
  value: unknown
): NormalizedAccountDeletionOperationsRequest {
  const source = normalizeRecord(value);
  const rawFilter = String(source['filter'] ?? 'attention')
    .trim()
    .toLowerCase() as AccountDeletionOperationFilter;
  const filter = ALLOWED_FILTERS.has(rawFilter) ? rawFilter : 'attention';
  const parsedLimit = Math.trunc(Number(source['limit']));
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  return {
    filter,
    limit,
    cursor: normalizeCursor(source['cursor']),
  };
}

export function mapAccountDeletionOperation(
  documentId: string,
  value: unknown
): AccountDeletionOperationItem {
  const source = normalizeRecord(value);
  const phase = normalizeToken(source['purgePhase'], 80) || 'pending';
  const authDeletionStatus =
    normalizeToken(source['authDeletionStatus'], 80) || 'unknown';
  const firestoreDeletionStatus =
    normalizeToken(source['firestoreDeletionStatus'], 80) || 'unknown';
  const dataDeletionStatus =
    normalizeToken(source['dataDeletionStatus'], 80) || 'unknown';
  const nextAttemptAt = normalizeEpoch(source['purgeNextAttemptAt']);
  const lastErrorCode = normalizeNullableToken(
    source['purgeLastErrorCode'],
    120
  );
  const status = resolveStatus({
    phase,
    firestoreDeletionStatus,
    dataDeletionStatus,
    authDeletionStatus,
    nextAttemptAt,
    lastErrorCode,
  });

  return {
    reference: buildPurgeCandidateReference(documentId),
    status,
    phase,
    source: normalizeSource(source['source']),
    attemptCount: normalizeCount(source['purgeAttemptCount']),
    policyVersion: normalizeNullableCount(
      source['dataRetentionPolicyVersion']
    ),
    authDeletionStatus,
    firestoreDeletionStatus,
    dataDeletionStatus,
    completedDomainCount: normalizeStringArray(
      source['dataDeletionCompletedDomains'],
      MAX_BLOCKING_DOMAINS
    ).length,
    blockingDomains: normalizeDomains(source['dataDeletionBlockers']),
    nextAttemptAt,
    retryDelayMs: normalizeEpoch(source['purgeRetryDelayMs']),
    leaseUntil: normalizeEpoch(source['purgeLeaseUntil']),
    lastErrorCode,
    lastErrorCategory: normalizeNullableToken(
      source['purgeLastErrorCategory'],
      80
    ),
    lastErrorPhase: normalizeNullableToken(
      source['purgeLastErrorPhase'],
      80
    ),
    deletionRequestedAt: normalizeEpoch(source['deletionRequestedAt']),
    deletedAt: normalizeEpoch(source['deletedAt']),
    purgeAfter: normalizeEpoch(source['purgeAfter']),
    updatedAt: normalizeEpoch(source['updatedAt']) ?? 0,
  };
}

export function matchesAccountDeletionOperationFilter(
  item: AccountDeletionOperationItem,
  filter: AccountDeletionOperationFilter
): boolean {
  if (filter === 'all') return true;
  if (filter === 'attention') {
    return (
      item.status === 'blocked' ||
      item.status === 'retry_scheduled' ||
      item.authDeletionStatus === 'failed' ||
      item.lastErrorCode !== null
    );
  }
  return item.status === filter;
}

export function cursorForAccountDeletionOperation(
  item: AccountDeletionOperationItem
): AccountDeletionOperationsCursor | null {
  return item.updatedAt > 0
    ? { updatedAt: item.updatedAt, reference: item.reference }
    : null;
}

function resolveStatus(input: {
  phase: string;
  firestoreDeletionStatus: string;
  dataDeletionStatus: string;
  authDeletionStatus: string;
  nextAttemptAt: number | null;
  lastErrorCode: string | null;
}): AccountDeletionOperationStatus {
  if (
    input.phase === 'completed' ||
    input.firestoreDeletionStatus === 'success'
  ) {
    return 'completed';
  }
  if (input.phase === 'blocked' || input.dataDeletionStatus === 'blocked') {
    return 'blocked';
  }
  if (
    input.phase === 'retry_scheduled' ||
    input.nextAttemptAt !== null ||
    input.authDeletionStatus === 'failed' ||
    input.lastErrorCode !== null
  ) {
    return 'retry_scheduled';
  }
  if (IN_PROGRESS_PHASES.has(input.phase)) return 'in_progress';
  return 'pending';
}

function normalizeCursor(value: unknown): AccountDeletionOperationsCursor | null {
  const source = normalizeRecord(value);
  const updatedAt = normalizeEpoch(source['updatedAt']);
  const reference = String(source['reference'] ?? '')
    .trim()
    .toLowerCase();

  return updatedAt && /^[a-f0-9]{16}$/.test(reference)
    ? { updatedAt, reference }
    : null;
}

function normalizeSource(
  value: unknown
): AccountDeletionOperationItem['source'] {
  const source = String(value ?? '').trim().toLowerCase();
  return source === 'self' || source === 'moderator' || source === 'system'
    ? source
    : 'unknown';
}

function normalizeDomains(value: unknown): AccountDataDomain[] {
  return normalizeStringArray(value, MAX_BLOCKING_DOMAINS).filter(
    (domain): domain is AccountDataDomain =>
      ALLOWED_DOMAINS.has(domain as AccountDataDomain)
  );
}

function normalizeStringArray(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map((item) => String(item ?? '').trim().toLowerCase())
      .filter(Boolean)
  )].slice(0, maximum);
}

function normalizeToken(value: unknown, maximum: number): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maximum);
}

function normalizeNullableToken(
  value: unknown,
  maximum: number
): string | null {
  const normalized = normalizeToken(value, maximum);
  return normalized || null;
}

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeNullableCount(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeEpoch(value: unknown): number | null {
  if (
    value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    const millis = Number((value as { toMillis: () => number }).toMillis());
    return Number.isFinite(millis) && millis > 0 ? Math.trunc(millis) : null;
  }

  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
