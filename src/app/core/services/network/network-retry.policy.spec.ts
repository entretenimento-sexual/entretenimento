import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, defer, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isTransientNetworkError,
  retryIdempotentRead,
} from './network-retry.policy';

describe('network-retry.policy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('classifica erros transitórios conhecidos', () => {
    expect(isTransientNetworkError({ code: 'functions/unavailable' })).toBe(true);
    expect(isTransientNetworkError({ code: 'auth/network-request-failed' })).toBe(true);
    expect(isTransientNetworkError(new HttpErrorResponse({ status: 503 }))).toBe(true);
    expect(isTransientNetworkError(new Error('failed to fetch'))).toBe(true);
  });

  it('não classifica falhas permanentes como transitórias', () => {
    expect(isTransientNetworkError({ code: 'permission-denied' })).toBe(false);
    expect(isTransientNetworkError(new HttpErrorResponse({ status: 403 }))).toBe(false);
    expect(isTransientNetworkError(new Error('payload inválido'))).toBe(false);
  });

  it('repete uma leitura transitória até o limite e conclui', async () => {
    let attempts = 0;
    const resultPromise = firstValueFrom(
      defer(() => {
        attempts += 1;
        return attempts < 3
          ? throwError(() => ({ code: 'functions/unavailable' }))
          : of('ok');
      }).pipe(
        retryIdempotentRead({
          maximumRetries: 2,
          baseDelayMs: 100,
          maximumDelayMs: 200,
          isOnline: () => true,
        })
      )
    );

    await vi.advanceTimersByTimeAsync(300);

    await expect(resultPromise).resolves.toBe('ok');
    expect(attempts).toBe(3);
  });

  it('não repete quando o browser está offline', async () => {
    let attempts = 0;
    const resultPromise = firstValueFrom(
      defer(() => {
        attempts += 1;
        return throwError(() => ({ code: 'functions/unavailable' }));
      }).pipe(
        retryIdempotentRead({
          maximumRetries: 2,
          baseDelayMs: 100,
          isOnline: () => false,
        })
      )
    );

    await expect(resultPromise).rejects.toEqual({
      code: 'functions/unavailable',
    });
    expect(attempts).toBe(1);
  });

  it('não repete falhas permanentes', async () => {
    let attempts = 0;
    const resultPromise = firstValueFrom(
      defer(() => {
        attempts += 1;
        return throwError(() => ({ code: 'permission-denied' }));
      }).pipe(
        retryIdempotentRead({
          maximumRetries: 2,
          baseDelayMs: 100,
          isOnline: () => true,
        })
      )
    );

    await expect(resultPromise).rejects.toEqual({ code: 'permission-denied' });
    expect(attempts).toBe(1);
  });
});
