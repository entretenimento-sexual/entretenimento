// src/app/core/services/general/cache/app-cache.service.ts
// Nova fachada tipada de cache.
//
// Características:
// - memória como primeira camada;
// - persistência somente quando a definição solicita;
// - envelope com TTL, stale window, versão, escopo e proprietário;
// - null continua sendo valor legítimo;
// - falha de IndexedDB é best-effort e segue para o handler global;
// - nenhuma notificação visual é emitida por esta infraestrutura.
import { Injectable } from '@angular/core';
import { Observable, defer, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import {
  CACHE_MISS,
  CacheDefinition,
  CacheEnvelope,
  CacheResult,
} from './cache-contracts';
import { CachePersistenceService } from './cache-persistence.service';

class CacheConfigurationError extends Error {
  override readonly name = 'CacheConfigurationError';
}

@Injectable({ providedIn: 'root' })
export class AppCacheService {
  private static readonly STORAGE_PREFIX = 'app-cache:';

  private readonly memory = new Map<string, CacheEnvelope<unknown>>();
  private readonly inFlightReads = new Map<
    string,
    Observable<CacheResult<unknown>>
  >();

  constructor(
    private readonly persistence: CachePersistenceService,
    private readonly globalError: GlobalErrorHandlerService
  ) {}

  get$<T>(definition: CacheDefinition<T>): Observable<CacheResult<T>> {
    return defer(() => {
      const normalized = this.normalizeDefinition(definition);
      const storageKey = this.storageKey(normalized);
      const memoryEnvelope = this.memory.get(storageKey);

      if (memoryEnvelope) {
        const result = this.evaluateEnvelope(normalized, memoryEnvelope);

        if (result) {
          return of(result);
        }

        this.memory.delete(storageKey);
      }

      if (normalized.storage === 'memory') {
        return of(CACHE_MISS as CacheResult<T>);
      }

      const inFlight = this.inFlightReads.get(storageKey);
      if (inFlight) {
        return inFlight as Observable<CacheResult<T>>;
      }

      const read$ = this.persistence
        .getEnvelopePersistent<T>(storageKey)
        .pipe(
          switchMap((envelope) => {
            if (!envelope) {
              return of(CACHE_MISS as CacheResult<T>);
            }

            const result = this.evaluateEnvelope(normalized, envelope);

            if (result) {
              this.memory.set(storageKey, envelope);
              return of(result);
            }

            return this.persistence.deletePersistent(storageKey).pipe(
              map(() => CACHE_MISS as CacheResult<T>),
              catchError((error) => {
                this.report(error, 'AppCacheService.get$:deleteInvalid', {
                  storageKey,
                });
                return of(CACHE_MISS as CacheResult<T>);
              })
            );
          }),
          catchError((error) => {
            this.report(error, 'AppCacheService.get$:persistence', {
              storageKey,
            });
            return of(CACHE_MISS as CacheResult<T>);
          })
        );

      const shared$ = read$.pipe(
        // O Observable de persistência completa após uma emissão; o Map apenas
        // coalesce chamadas concorrentes e não vira um cache adicional.
        map((result) => result as CacheResult<unknown>)
      );

      this.inFlightReads.set(storageKey, shared$);

      return shared$.pipe(
        map((result) => result as CacheResult<T>),
        catchError((error) => {
          this.report(error, 'AppCacheService.get$:inFlight', { storageKey });
          return of(CACHE_MISS as CacheResult<T>);
        }),
        // finalize foi evitado aqui para não criar outra inscrição. A leitura
        // completa uma vez; removemos a referência na própria emissão.
        map((result) => {
          this.inFlightReads.delete(storageKey);
          return result;
        })
      );
    }).pipe(
      catchError((error) => {
        if (error instanceof CacheConfigurationError) {
          return throwError(() => error);
        }

        this.report(error, 'AppCacheService.get$');
        return of(CACHE_MISS as CacheResult<T>);
      })
    );
  }

  set$<T>(
    definition: CacheDefinition<T>,
    value: T
  ): Observable<void> {
    return defer(() => {
      const normalized = this.normalizeDefinition(definition);

      if (normalized.validate && !normalized.validate(value)) {
        throw new CacheConfigurationError(
          `[AppCacheService] Valor inválido para "${normalized.key}".`
        );
      }

      const storageKey = this.storageKey(normalized);
      const envelope = this.createEnvelope(normalized, value);
      this.memory.set(storageKey, envelope);

      if (normalized.storage === 'memory') {
        return of(void 0);
      }

      return this.persistence
        .setEnvelopePersistent(storageKey, envelope)
        .pipe(
          catchError((error) => {
            // A memória continua válida. IndexedDB é uma otimização best-effort.
            this.report(error, 'AppCacheService.set$:persistence', {
              storageKey,
            });
            return of(void 0);
          })
        );
    });
  }

  invalidate$(definition: CacheDefinition<unknown>): Observable<void> {
    return defer(() => {
      const normalized = this.normalizeDefinition(definition);
      const storageKey = this.storageKey(normalized);

      this.memory.delete(storageKey);
      this.inFlightReads.delete(storageKey);

      if (normalized.storage === 'memory') {
        return of(void 0);
      }

      return this.persistence.deletePersistent(storageKey).pipe(
        catchError((error) => {
          this.report(error, 'AppCacheService.invalidate$', { storageKey });
          return of(void 0);
        })
      );
    });
  }

  clearUserScope$(ownerUid: string): Observable<void> {
    const uid = String(ownerUid ?? '').trim();

    if (!uid) {
      return throwError(
        () =>
          new CacheConfigurationError(
            '[AppCacheService] UID obrigatório para limpar cache user-scoped.'
          )
      );
    }

    return this.clearByPrefix$(
      `${AppCacheService.STORAGE_PREFIX}user:${encodeURIComponent(uid)}:`
    );
  }

  clearSessionScope$(): Observable<void> {
    return this.clearByPrefix$(
      `${AppCacheService.STORAGE_PREFIX}session:`
    );
  }

  clearMemory(): void {
    this.memory.clear();
    this.inFlightReads.clear();
  }

  private clearByPrefix$(prefix: string): Observable<void> {
    for (const key of Array.from(this.memory.keys())) {
      if (key.startsWith(prefix)) {
        this.memory.delete(key);
      }
    }

    for (const key of Array.from(this.inFlightReads.keys())) {
      if (key.startsWith(prefix)) {
        this.inFlightReads.delete(key);
      }
    }

    return this.persistence.deletePersistentByPrefix(prefix).pipe(
      map(() => void 0),
      catchError((error) => {
        this.report(error, 'AppCacheService.clearByPrefix$', { prefix });
        return of(void 0);
      })
    );
  }

  private createEnvelope<T>(
    definition: CacheDefinition<T>,
    value: T
  ): CacheEnvelope<T> {
    const createdAt = Date.now();
    const expiresAt =
      definition.ttlMs === null
        ? null
        : createdAt + definition.ttlMs;
    const staleWindow = definition.staleWhileRevalidateMs ?? 0;

    return {
      value,
      createdAt,
      expiresAt,
      staleUntil:
        expiresAt === null ? null : expiresAt + staleWindow,
      version: definition.version,
      scope: definition.scope,
      sensitivity: definition.sensitivity,
      ...(definition.ownerUid
        ? { ownerUid: definition.ownerUid }
        : {}),
    };
  }

  private evaluateEnvelope<T>(
    definition: CacheDefinition<T>,
    rawEnvelope: CacheEnvelope<unknown>
  ): CacheResult<T> | null {
    if (!this.isCompatibleEnvelope(definition, rawEnvelope)) {
      return null;
    }

    const value = rawEnvelope.value;

    if (definition.validate && !definition.validate(value)) {
      return null;
    }

    const now = Date.now();

    if (
      rawEnvelope.expiresAt === null ||
      now <= rawEnvelope.expiresAt
    ) {
      return { status: 'fresh', value: value as T };
    }

    if (
      rawEnvelope.staleUntil !== null &&
      now <= rawEnvelope.staleUntil
    ) {
      return { status: 'stale', value: value as T };
    }

    return null;
  }

  private isCompatibleEnvelope<T>(
    definition: CacheDefinition<T>,
    envelope: CacheEnvelope<unknown>
  ): boolean {
    if (!envelope || typeof envelope !== 'object') return false;

    return (
      envelope.version === definition.version &&
      envelope.scope === definition.scope &&
      envelope.sensitivity === definition.sensitivity &&
      String(envelope.ownerUid ?? '') ===
        String(definition.ownerUid ?? '') &&
      typeof envelope.createdAt === 'number' &&
      Number.isFinite(envelope.createdAt) &&
      (envelope.expiresAt === null ||
        (typeof envelope.expiresAt === 'number' &&
          Number.isFinite(envelope.expiresAt))) &&
      (envelope.staleUntil === null ||
        (typeof envelope.staleUntil === 'number' &&
          Number.isFinite(envelope.staleUntil)))
    );
  }

  private normalizeDefinition<T>(
    definition: CacheDefinition<T>
  ): CacheDefinition<T> {
    const key = String(definition?.key ?? '').trim();
    const ownerUid = String(definition?.ownerUid ?? '').trim();
    const version = Number(definition?.version);
    const ttlMs = definition?.ttlMs;
    const staleWhileRevalidateMs =
      definition?.staleWhileRevalidateMs ?? 0;

    if (!key) {
      throw new CacheConfigurationError(
        '[AppCacheService] CacheDefinition.key é obrigatório.'
      );
    }

    if (!Number.isInteger(version) || version < 1) {
      throw new CacheConfigurationError(
        `[AppCacheService] Versão inválida para "${key}".`
      );
    }

    if (
      ttlMs !== null &&
      (!Number.isFinite(ttlMs) || ttlMs < 0)
    ) {
      throw new CacheConfigurationError(
        `[AppCacheService] TTL inválido para "${key}".`
      );
    }

    if (
      !Number.isFinite(staleWhileRevalidateMs) ||
      staleWhileRevalidateMs < 0
    ) {
      throw new CacheConfigurationError(
        `[AppCacheService] Janela stale inválida para "${key}".`
      );
    }

    if (definition.scope === 'user' && !ownerUid) {
      throw new CacheConfigurationError(
        `[AppCacheService] ownerUid obrigatório para "${key}".`
      );
    }

    if (
      definition.sensitivity === 'restricted' &&
      definition.storage === 'persistent'
    ) {
      throw new CacheConfigurationError(
        `[AppCacheService] Dado restrito não pode ser persistido: "${key}".`
      );
    }

    return {
      ...definition,
      key,
      version,
      ttlMs,
      staleWhileRevalidateMs,
      ...(definition.scope === 'user' ? { ownerUid } : {}),
    };
  }

  private storageKey<T>(definition: CacheDefinition<T>): string {
    const ownerSegment =
      definition.scope === 'user'
        ? `${encodeURIComponent(definition.ownerUid ?? '')}:`
        : '';

    return `${AppCacheService.STORAGE_PREFIX}${definition.scope}:${ownerSegment}${encodeURIComponent(definition.key)}`;
  }

  private report(
    error: unknown,
    operation: string,
    context?: Record<string, unknown>
  ): void {
    try {
      const wrapped =
        error instanceof Error
          ? error
          : new Error('[AppCacheService] internal error');

      (wrapped as any).original = error;
      (wrapped as any).feature = 'app-cache';
      (wrapped as any).context = { operation, ...(context ?? {}) };
      (wrapped as any).silent = true;
      (wrapped as any).skipUserNotification = true;

      this.globalError.handleError(wrapped);
    } catch {
      // Cache não deve quebrar o fluxo principal por falha de telemetria.
    }
  }
}
