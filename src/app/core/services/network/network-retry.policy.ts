// src/app/core/services/network/network-retry.policy.ts
// -----------------------------------------------------------------------------
// IDEMPOTENT NETWORK READ RETRY POLICY
// -----------------------------------------------------------------------------
// Retry limitado somente para leituras idempotentes e erros transitórios.
// Escritas e comandos não devem usar esta política automaticamente.
// -----------------------------------------------------------------------------
import { HttpErrorResponse } from '@angular/common/http';
import {
  MonoTypeOperatorFunction,
  throwError,
  timer,
} from 'rxjs';
import { retry } from 'rxjs/operators';

const TRANSIENT_CODES = new Set([
  'auth/network-request-failed',
  'deadline-exceeded',
  'firestore/unavailable',
  'functions/deadline-exceeded',
  'functions/unavailable',
  'network-request-failed',
  'storage/retry-limit-exceeded',
  'unavailable',
]);
const TRANSIENT_HTTP_STATUS = new Set([0, 408, 425, 429, 500, 502, 503, 504]);

export interface IdempotentReadRetryOptions {
  maximumRetries?: number;
  baseDelayMs?: number;
  maximumDelayMs?: number;
  isOnline?: () => boolean;
}

export function retryIdempotentRead<T>(
  options: IdempotentReadRetryOptions = {}
): MonoTypeOperatorFunction<T> {
  const maximumRetries = normalizeInteger(
    options.maximumRetries,
    2,
    0,
    4
  );
  const baseDelayMs = normalizeInteger(
    options.baseDelayMs,
    500,
    100,
    5_000
  );
  const maximumDelayMs = normalizeInteger(
    options.maximumDelayMs,
    4_000,
    baseDelayMs,
    15_000
  );
  const isOnline = options.isOnline ?? (() => true);

  return retry({
    count: maximumRetries,
    resetOnSuccess: true,
    delay: (error: unknown, retryCount: number) => {
      if (!isOnline() || !isTransientNetworkError(error)) {
        return throwError(() => error);
      }

      const delayMs = Math.min(
        baseDelayMs * (2 ** Math.max(0, retryCount - 1)),
        maximumDelayMs
      );
      return timer(delayMs);
    },
  });
}

export function isTransientNetworkError(error: unknown): boolean {
  if (error instanceof HttpErrorResponse) {
    return TRANSIENT_HTTP_STATUS.has(error.status);
  }

  const source = (error ?? {}) as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
    name?: unknown;
  };
  const code = normalizeCode(source.code);
  const status = Math.trunc(Number(source.status));
  const message = String(source.message ?? '').trim().toLowerCase();
  const name = String(source.name ?? '').trim().toLowerCase();

  return (
    TRANSIENT_CODES.has(code) ||
    TRANSIENT_HTTP_STATUS.has(status) ||
    name === 'networkerror' ||
    message === 'failed to fetch' ||
    message.includes('network request failed')
  );
}

function normalizeCode(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^firebaseerror:\s*/i, '');
}

function normalizeInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, minimum), maximum)
    : fallback;
}
