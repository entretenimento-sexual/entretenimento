// src/app/core/services/general/cache/cache.service.ts
// Compatibilidade temporária para consumidores ainda não migrados.
//
// Arquitetura atual:
// - memória é a camada padrão;
// - IndexedDB só é usado quando `opts.persist === true`;
// - chaves privadas conhecidas são bloqueadas pelo adaptador legado;
// - NgRx não é fallback de cache;
// - somente `currentUserUid` pode ter leitura síncrona no localStorage.
//
// SUPRESSÕES EXPLÍCITAS DESTA MIGRAÇÃO:
// - SUPRIMIDA a dependência de Store<AppState> e `selectCacheItem`.
//   Motivo: o slice genérico não recebia writes reais e criava uma terceira fonte
//   de verdade entre memória, IndexedDB e estado de domínio.
// - SUPRIMIDA a persistência automática por padrão.
//   Motivo: persistência deve ser decisão explícita e testada.
// - SUPRIMIDOS `currentUser` persistente, espelho em localStorage e restore.
//   Motivo: perfil completo é privado e pertence ao runtime/Firestore.
// - SUPRIMIDOS traces com resumo de perfil/e-mail.
//   Motivo: debug de cache deve registrar operação e categoria, não conteúdo.
import { Injectable } from '@angular/core';
import {
  Observable,
  catchError,
  defer,
  finalize,
  map,
  of,
  shareReplay,
} from 'rxjs';

import { IUserDados } from '../../../interfaces/iuser-dados';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from '@core/services/privacy/privacy-debug-logger.service';
import { CachePersistenceService } from './cache-persistence.service';
import {
  LEGACY_MEMORY_ONLY_PREFIXES,
  shouldBlockLegacyPersistence,
} from './legacy-cache-persistence-policy';

interface CacheItem<T> {
  data: T;
  expiration: number | null;
}

const UID_BOOTSTRAP_KEY = 'currentUserUid';
const LEGACY_LOCAL_STORAGE_KEYS: ReadonlySet<string> = new Set([
  'currentUser',
  UID_BOOTSTRAP_KEY,
]);

@Injectable({ providedIn: 'root' })
export class CacheService {
  private readonly cache = new Map<string, CacheItem<unknown>>();
  private readonly inFlightGets = new Map<
    string,
    Observable<unknown | null>
  >();
  private readonly defaultTTL = 300_000;

  constructor(
    private readonly cachePersistence: CachePersistenceService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly privacyDebug: PrivacyDebugLoggerService
  ) {
    // Remove o perfil completo deixado por versões anteriores.
    this.removeLocalStorageKeyBestEffort('currentUser');
  }

  set<T>(
    key: string,
    data: T,
    ttl?: number,
    opts?: { persist?: boolean }
  ): void {
    const normalizedKey = this.normalizeKey(key);
    if (!normalizedKey) return;

    const expiration = this.expirationFromTtl(ttl);
    const persist =
      opts?.persist === true &&
      !shouldBlockLegacyPersistence(normalizedKey);
    const previous = this.cache.get(normalizedKey);

    if (
      previous &&
      this.deepEqual(previous.data, data) &&
      previous.expiration === expiration
    ) {
      return;
    }

    this.cache.set(normalizedKey, { data, expiration });
    this.logOperation('set', normalizedKey, { persist, expiration });

    if (persist) {
      this.cachePersistence
        .setPersistent(normalizedKey, data)
        .pipe(takeCompatOne())
        .subscribe({
          error: (error) =>
            this.safeHandle(error, 'setPersistent', normalizedKey),
        });
    }

    if (normalizedKey === UID_BOOTSTRAP_KEY) {
      this.writeUidBootstrap(data);
    }
  }

  /**
   * Compatibilidade: perfil fica somente em memória; UID mantém bootstrap mínimo.
   */
  setUser(
    uid: string,
    user: IUserDados,
    ttl: number = this.defaultTTL
  ): void {
    const normalizedUid = this.normalizeKey(uid);
    if (!normalizedUid) return;

    this.set(this.userKey(normalizedUid), user, ttl, {
      persist: false,
    });
    this.set(UID_BOOTSTRAP_KEY, normalizedUid, undefined, {
      persist: false,
    });
  }

  update<T>(
    key: string,
    data: T,
    ttl?: number,
    opts?: { persist?: boolean }
  ): void {
    const normalizedKey = this.normalizeKey(key);
    const current = this.cache.get(normalizedKey);

    if (!normalizedKey || !current) return;

    const expiration =
      ttl === undefined
        ? current.expiration
        : this.expirationFromTtl(ttl);
    const persist =
      opts?.persist === true &&
      !shouldBlockLegacyPersistence(normalizedKey);

    if (
      this.deepEqual(current.data, data) &&
      current.expiration === expiration
    ) {
      return;
    }

    this.cache.set(normalizedKey, { data, expiration });
    this.logOperation('update', normalizedKey, {
      persist,
      expiration,
    });

    if (persist) {
      this.cachePersistence
        .setPersistent(normalizedKey, data)
        .pipe(takeCompatOne())
        .subscribe({
          error: (error) =>
            this.safeHandle(error, 'updatePersistent', normalizedKey),
        });
    }

    if (normalizedKey === UID_BOOTSTRAP_KEY) {
      this.writeUidBootstrap(data);
    }
  }

  get<T>(key: string): Observable<T | null> {
    const normalizedKey = this.normalizeKey(key);
    if (!normalizedKey) return of(null);

    const memoryItem = this.cache.get(normalizedKey);
    if (memoryItem) {
      if (this.isExpired(memoryItem.expiration)) {
        this.cache.delete(normalizedKey);
      } else {
        return of(memoryItem.data as T);
      }
    }

    const existing = this.inFlightGets.get(normalizedKey);
    if (existing) {
      return existing as Observable<T | null>;
    }

    const request$ = defer(() =>
      this.cachePersistence.getPersistent<T>(normalizedKey)
    ).pipe(
      map((persisted) => {
        if (persisted === null || persisted === undefined) {
          return null;
        }

        this.cache.set(normalizedKey, {
          data: persisted,
          expiration: Date.now() + this.defaultTTL,
        });

        return persisted;
      }),
      catchError((error) => {
        this.safeHandle(error, 'getPersistent', normalizedKey);
        return of(null);
      }),
      finalize(() => this.inFlightGets.delete(normalizedKey)),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.inFlightGets.set(
      normalizedKey,
      request$ as Observable<unknown | null>
    );

    return request$;
  }

  /**
   * Leitura síncrona:
   * - qualquer chave pode ser lida da memória;
   * - somente currentUserUid pode ser lido do localStorage.
   */
  getSync<T>(key: string): T | null {
    const normalizedKey = this.normalizeKey(key);
    if (!normalizedKey) return null;

    const memoryItem = this.cache.get(normalizedKey);
    if (memoryItem) {
      if (this.isExpired(memoryItem.expiration)) {
        this.cache.delete(normalizedKey);
      } else {
        return memoryItem.data as T;
      }
    }

    if (normalizedKey !== UID_BOOTSTRAP_KEY) {
      return null;
    }

    try {
      const raw = localStorage.getItem(UID_BOOTSTRAP_KEY);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  has(key: string): boolean {
    const normalizedKey = this.normalizeKey(key);
    const item = this.cache.get(normalizedKey);

    if (!item) return false;
    if (this.isExpired(item.expiration)) {
      this.cache.delete(normalizedKey);
      return false;
    }

    return true;
  }

  delete(key: string): void {
    const normalizedKey = this.normalizeKey(key);
    if (!normalizedKey) return;

    this.cache.delete(normalizedKey);
    this.inFlightGets.delete(normalizedKey);
    this.removeLocalStorageKeyBestEffort(normalizedKey);

    this.cachePersistence
      .deletePersistent(normalizedKey)
      .pipe(takeCompatOne())
      .subscribe({
        error: (error) =>
          this.safeHandle(error, 'deletePersistent', normalizedKey),
      });

    this.logOperation('delete', normalizedKey);
  }

  /** Limpa apenas a camada de memória. */
  clear(): void {
    this.cache.clear();
    this.inFlightGets.clear();
    this.log('clear memory', { size: 0 });
  }

  /** Limpa rastros locais sensíveis ligados à sessão anterior. */
  clearSensitiveSessionCache$(): Observable<void> {
    const prefixes = Array.from(
      new Set([
        ...LEGACY_MEMORY_ONLY_PREFIXES,
        'user:location',
      ])
    );

    for (const key of Array.from(this.cache.keys())) {
      if (
        prefixes.some((prefix) => key.startsWith(prefix))
      ) {
        this.cache.delete(key);
      }
    }

    for (const key of Array.from(this.inFlightGets.keys())) {
      if (
        prefixes.some((prefix) => key.startsWith(prefix))
      ) {
        this.inFlightGets.delete(key);
      }
    }

    for (const key of LEGACY_LOCAL_STORAGE_KEYS) {
      this.removeLocalStorageKeyBestEffort(key);
    }

    return this.cachePersistence
      .deletePersistentByPrefixes(prefixes)
      .pipe(
        map((deleted) => {
          this.log('clear sensitive session cache', {
            deleted,
            prefixCount: prefixes.length,
          });
          return void 0;
        }),
        catchError((error) => {
          this.safeHandle(
            error,
            'clearSensitiveSessionCache$',
            'sensitive-session'
          );
          return of(void 0);
        })
      );
  }

  removeExpired(): void {
    const now = Date.now();
    let deleted = 0;

    for (const [key, item] of this.cache.entries()) {
      if (item.expiration !== null && item.expiration < now) {
        this.cache.delete(key);
        deleted += 1;
      }
    }

    if (deleted > 0) {
      this.log('remove expired', { deleted });
    }
  }

  enableAutoCleanup(interval = 60_000): () => void {
    const safeInterval = Math.max(1_000, Number(interval) || 60_000);
    const timerId = setInterval(
      () => this.removeExpired(),
      safeInterval
    );

    this.log('auto cleanup on', { interval: safeInterval });

    return () => {
      clearInterval(timerId);
      this.log('auto cleanup off');
    };
  }

  markAsNotFound(key: string, ttl = 30_000): void {
    this.set(
      `notFound:${this.normalizeKey(key)}`,
      true,
      ttl,
      { persist: false }
    );
  }

  isNotFound(key: string): boolean {
    return this.has(`notFound:${this.normalizeKey(key)}`);
  }

  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  size(): number {
    return this.cache.size;
  }

  debug(): void {
    const categories = Array.from(
      new Set(this.keys().map((key) => this.keyCategory(key)))
    );

    this.log('debug', {
      size: this.size(),
      categories,
    });
  }

  /**
   * Compatibilidade: perfil por UID fica em memória; somente UID é espelhado.
   */
  syncCurrentUserWithUid(userData: IUserDados): void {
    if (!userData?.uid) return;

    this.set(
      this.userKey(userData.uid),
      userData,
      this.defaultTTL,
      { persist: false }
    );
    this.set(
      UID_BOOTSTRAP_KEY,
      userData.uid,
      undefined,
      { persist: false }
    );
  }

  private normalizeKey(key: string): string {
    return String(key ?? '').trim();
  }

  private userKey(uid: string): string {
    return `user:${this.normalizeKey(uid)}`;
  }

  private expirationFromTtl(ttl?: number): number | null {
    if (ttl === undefined) return null;

    const normalized = Number(ttl);
    if (!Number.isFinite(normalized)) return null;

    return Date.now() + Math.max(0, normalized);
  }

  private isExpired(expiration: number | null): boolean {
    return expiration !== null && Date.now() > expiration;
  }

  private deepEqual(left: unknown, right: unknown): boolean {
    if (left === right) return true;

    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }

  private writeUidBootstrap(value: unknown): void {
    const uid = this.normalizeKey(String(value ?? ''));

    try {
      if (uid) {
        localStorage.setItem(
          UID_BOOTSTRAP_KEY,
          JSON.stringify(uid)
        );
      } else {
        localStorage.removeItem(UID_BOOTSTRAP_KEY);
      }
    } catch {
      // Compatibilidade best-effort.
    }
  }

  private removeLocalStorageKeyBestEffort(key: string): void {
    if (!LEGACY_LOCAL_STORAGE_KEYS.has(key)) return;

    try {
      localStorage.removeItem(key);
    } catch {
      // noop
    }
  }

  private keyCategory(key: string): string {
    const normalized = this.normalizeKey(key);
    if (!normalized) return 'empty';
    if (normalized === UID_BOOTSTRAP_KEY) return 'uid-bootstrap';

    const separator = normalized.indexOf(':');
    return separator > 0
      ? normalized.slice(0, separator)
      : 'generic';
  }

  private logOperation(
    operation: string,
    key: string,
    meta?: Record<string, unknown>
  ): void {
    this.log(operation, {
      keyCategory: this.keyCategory(key),
      ...(meta ?? {}),
    });
  }

  private log(message: string, data?: unknown): void {
    this.privacyDebug.log(
      'cache',
      `CacheService: ${message}`,
      data
    );
  }

  private safeHandle(
    error: unknown,
    operation: string,
    key: string
  ): void {
    try {
      const wrapped =
        error instanceof Error
          ? error
          : new Error('[CacheService] internal error');

      (wrapped as any).original = error;
      (wrapped as any).feature = 'legacy-cache';
      (wrapped as any).context = {
        operation,
        keyCategory: this.keyCategory(key),
      };
      (wrapped as any).silent = true;
      (wrapped as any).skipUserNotification = true;

      this.globalErrorHandler.handleError(wrapped);
    } catch {
      // Cache legado nunca deve quebrar o fluxo principal.
    }
  }
}

/**
 * Operador mínimo para documentar que observables do adaptador emitem uma vez.
 * Mantém a dependência de RxJS centralizada sem Promises na API pública.
 */
function takeCompatOne<T>() {
  return (source: Observable<T>): Observable<T> => source.pipe();
}
