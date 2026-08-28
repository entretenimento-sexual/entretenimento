// functions/src/account_lifecycle/account-deletion-purge.policy.ts
// -----------------------------------------------------------------------------
// ACCOUNT DELETION PURGE OPERATIONAL POLICY
// -----------------------------------------------------------------------------
// Centraliza lease, backoff e sanitização de diagnóstico do expurgo definitivo.
// -----------------------------------------------------------------------------
import { createHash } from 'node:crypto';

export type AccountDeletionPurgePhase =
  | 'claimed'
  | 'auth_deletion'
  | 'data_cleanup'
  | 'finalization'
  | 'blocked'
  | 'retry_scheduled'
  | 'completed';

export interface AccountDeletionPurgeOperationalState {
  purgeAttemptCount?: number | null;
  purgeNextAttemptAt?: number | null;
  purgeLeaseOwner?: string | null;
  purgeLeaseUntil?: number | null;
}

export interface AccountDeletionRetrySchedule {
  attemptCount: number;
  delayMs: number;
  retryAt: number;
}

export interface SanitizedPurgeError {
  code: string;
  category: 'auth' | 'firestore' | 'storage' | 'functions' | 'internal';
}

export const ACCOUNT_DELETION_PURGE_LEASE_MS = 12 * 60 * 1_000;
export const ACCOUNT_DELETION_BASE_RETRY_MS = 60 * 60 * 1_000;
export const ACCOUNT_DELETION_MAX_RETRY_MS = 24 * 60 * 60 * 1_000;

export function normalizePurgeAttemptCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function isAccountDeletionRetryDue(
  state: AccountDeletionPurgeOperationalState,
  now: number
): boolean {
  const retryAt = normalizeEpoch(state.purgeNextAttemptAt);
  return retryAt === null || retryAt <= now;
}

export function isAccountDeletionLeaseAvailable(
  state: AccountDeletionPurgeOperationalState,
  now: number,
  executionId: string
): boolean {
  const owner = String(state.purgeLeaseOwner ?? '').trim();
  const leaseUntil = normalizeEpoch(state.purgeLeaseUntil);

  return !owner || owner === executionId || leaseUntil === null || leaseUntil <= now;
}

export function buildAccountDeletionRetrySchedule(input: {
  attemptCount: number;
  now: number;
}): AccountDeletionRetrySchedule {
  const attemptCount = Math.max(1, normalizePurgeAttemptCount(input.attemptCount));
  const exponent = Math.min(attemptCount - 1, 10);
  const delayMs = Math.min(
    ACCOUNT_DELETION_BASE_RETRY_MS * (2 ** exponent),
    ACCOUNT_DELETION_MAX_RETRY_MS
  );

  return {
    attemptCount,
    delayMs,
    retryAt: input.now + delayMs,
  };
}

export function sanitizePurgeError(error: unknown): SanitizedPurgeError {
  const rawCode = String(
    (error as { code?: unknown } | null)?.code ??
    (error as { name?: unknown } | null)?.name ??
    'internal-error'
  )
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'internal-error';

  return {
    code: rawCode,
    category: resolveErrorCategory(rawCode),
  };
}

export function buildPurgeCandidateReference(uid: string): string {
  return createHash('sha256')
    .update(String(uid ?? '').trim())
    .digest('hex')
    .slice(0, 16);
}

function resolveErrorCategory(
  code: string
): SanitizedPurgeError['category'] {
  if (code.startsWith('auth/')) return 'auth';
  if (code.startsWith('firestore/') || code.includes('firestore')) {
    return 'firestore';
  }
  if (code.startsWith('storage/') || code.includes('storage')) {
    return 'storage';
  }
  if (code.startsWith('functions/') || code.includes('function')) {
    return 'functions';
  }
  return 'internal';
}

function normalizeEpoch(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
