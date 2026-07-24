// src/app/core/services/general/cache/app-cache.service.ts
// Fachada tipada para o cache da aplicação.
//
// Princípios:
// - memória é a primeira camada;
// - persistência é sempre opt-in pela definição;
// - TTL, versão, escopo e proprietário acompanham o valor;
// - null pode ser valor legítimo, pois miss é discriminado;
// - dados restricted nunca são persistidos;
// - falhas do IndexedDB são best-effort e não geram toast.
import { Injectable } from '@angular/core';
import { Observable, defer, of, throwError } from 'rxjs';
import {
  catchError,
  finalize,
  map,
  shareReplay,
  switchMap,
} from 'rxjs/operators';

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

  /**
   * Leitura principal em camadas.
   * Consulta memória e, somente quando a definição permite, IndexedDB.
   */
  get$<T>(definition: CacheDefinition<T>): Observable<CacheResult<T>> {
    return defer(() => {
      const normalized = this.normalizeDefinition(definition);
      const storageKey = this.storageKey(normalized);
      const memoryResult = this.readMemory(normalized, storageKey);

      if (memoryResult.status !== 'miss') {
        return of(memoryResult);
      }

      if (normalized.storage === 'memory') {
        return of(CACHE_MISS as CacheResult<T>);
      }

      const existingRead = this.inFlightReads.get(storageKey);
      if (existingRead) {
        return existingRead as Observable<CacheResult<T>>;
      }

      const read$ = this.persistence
        .getEnvelopePersistent<T>(storageKey)
        .pipe(
          switchMap((envelope) => {
            if (!envelope) {
              return of(CACHE_MISS as CacheResult<T>);
            }

            const persistedResult = this.evaluateEnvelope(
              normalized,
              envelope
            );

            if (persistedResult) {
              this.memory.set(storageKey, envelope);
              return of(persistedResult);
            }

            return this.persistence.deletePersistent(storageKey).pipe(
              map(() => CACHE_MISS as CacheResult<T>),
              catchError((error) => {
                this.report(
                  error,
                  'AppCacheService.get$:deleteInvalid',
                  { storageKey }
                );
                return of(CACHE_MISS as CacheResult<T>);
              })
            );
          }),
          catchError((error) => {
            this.report(error, 'AppCacheService.get$:persistence', {
              storageKey,
            });
            return of(CACHE_MISS as CacheResult<T>);
          }),
          finalize(() => this.inFlightReads.delete(storageKey)),
          shareReplay({ bufferSize: 1, refCount: false })
        );

      this.inFlightReads.set(
        storageKey,
        read$ as Observable<CacheResult<unknown>>
      );

      return read$;
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

  /**
   * Snapshot síncrono exclusivamente da memória.
   *
   * Regras:
   * - nunca consulta IndexedDB;
   * - nunca cria inscrição ou side-effect externo;
   * - aplica versão, owner, validator, TTL e stale window;
   * - para fluxos novos, `get$()` continua sendo a API preferencial.
   */
  peek<T>(definition: CacheDefinition<T>): CacheResult<T> {
    const normalized = this.normalizeDefinition(definition);
    const storageKey = this.storageKey(normalized);

    return this.readMemory(normalized, storageKey);
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
            this.report(error, 'AppCacheService.set$:persistence', {
              storageKey,
            });
            return of(void 0);
          })
        );
    });
  }

  invalidate$<T>(definition: CacheDefinition<T>): Observable<void> {
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
          this.report(error, 'AppCacheService.invalidate$', {
            storageKey,
          });
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

  private readMemory<T>(
    definition: CacheDefinition<T>,
    storageKey: string
  ): CacheResult<T> {
    const envelope = this.memory.get(storageKey);

    if (!envelope) {
      return CACHE_MISS as CacheResult<T>;
    }

    const result = this.evaluateEnvelope(definition, envelope);

    if (result) {
      return result;
    }

    this.memory.delete(storageKey);
    return CACHE_MISS as CacheResult<T>;
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
    envelope: CacheEnvelope<unknown>
  ): CacheResult<T> | null {
    if (!this.isCompatibleEnvelope(definition, envelope)) {
      return null;
    }

    const value = envelope.value;

    if (definition.validate && !definition.validate(value)) {
      return null;
    }

    const now = Date.now();

    if (
      envelope.expiresAt === null ||
      now <= envelope.expiresAt
    ) {
      return { status: 'fresh', value: value as T };
    }

    if (
      envelope.staleUntil !== null &&
      now <= envelope.staleUntil
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

    if (!['global', 'session', 'user'].includes(definition.scope)) {
      throw new CacheConfigurationError(
        `[AppCacheService] Escopo inválido para "${key}".`
      );
    }

    if (
      !['public', 'private', 'restricted'].includes(
        definition.sensitivity
      )
    ) {
      throw new CacheConfigurationError(
        `[AppCacheService] Sensibilidade inválida para "${key}".`
      );
    }

    if (!['memory', 'persistent'].includes(definition.storage)) {
      throw new CacheConfigurationError(
        `[AppCacheService] Storage inválido para "${key}".`
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
      // Falha de telemetria nunca deve interromper o fluxo principal.
    }
  }
}
