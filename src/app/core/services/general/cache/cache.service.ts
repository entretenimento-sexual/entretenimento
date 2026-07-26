// src/app/core/services/general/cache/cache.service.ts
// -----------------------------------------------------------------------------
// Cache auxiliar da aplicação.
//
// Camadas:
// - memória: leitura rápida durante a sessão, limitada por política LRU;
// - IndexedDB: persistência temporária com expiração absoluta.
//
// Regras:
// - CacheService não é store de domínio;
// - estados transitórios de UI não devem ser persistidos;
// - Firebase e stores NgRx de domínio continuam sendo fontes de verdade;
// - dados expirados ou legados nunca são renovados silenciosamente;
// - uma leitura antiga não pode sobrescrever uma escrita mais recente;
// - a pressão de memória nunca remove a cópia persistida no IndexedDB.
// -----------------------------------------------------------------------------
import { Injectable, InjectionToken, inject } from '@angular/core';
import {
  Observable,
  catchError,
  defer,
  finalize,
  forkJoin,
  map,
  of,
  shareReplay,
  switchMap,
} from 'rxjs';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from '@core/services/privacy/privacy-debug-logger.service';
import { IUserDados } from '../../../interfaces/iuser-dados';
import { CachePersistenceService } from './cache-persistence.service';

interface CacheItem<T> {
  data: T;
  expiration: number | null;
}

interface CacheReadToken {
  generation: number;
  revision: number;
}

const HOT_KEYS: ReadonlySet<string> = new Set([
  'currentUser',
  'currentUserUid',
]);

/**
 * Limite da camada rápida em memória.
 *
 * Pode ser sobrescrito em testes ou em um bootstrap específico. O valor padrão
 * evita crescimento indefinido durante sessões longas, especialmente no mobile,
 * sem remover a cópia persistida das entradas que usam IndexedDB.
 */
export const CACHE_MEMORY_MAX_ENTRIES = new InjectionToken<number>(
  'CACHE_MEMORY_MAX_ENTRIES',
  {
    providedIn: 'root',
    factory: () => 250,
  }
);

@Injectable({ providedIn: 'root' })
export class CacheService {
  private readonly cache = new Map<string, CacheItem<unknown>>();
  private readonly inFlightGets = new Map<
    string,
    Observable<unknown | null>
  >();
  private readonly activeReadCounts = new Map<string, number>();
  private readonly keyRevisions = new Map<string, number>();

  private readonly maxMemoryEntries = this.normalizeMemoryLimit(
    inject(CACHE_MEMORY_MAX_ENTRIES)
  );
  private readonly defaultTTL = 300_000;
  private readonly logNoopDeletes = false;
  private mutationGeneration = 0;

  /**
   * Chaves exatas que não devem sobreviver ao encerramento de sessão.
   */
  private readonly sensitiveSessionExactKeys: ReadonlyArray<string> = [
    'currentUser',
    'currentUserUid',
    'discovery:public_profiles:all',
    'friendSettings',
    'loadingSearch',
    'loadingSettings',
  ];

  /**
   * Prefixos ligados a usuário, preferências, pesquisa, chat ou descoberta.
   * Inclui formatos legados para que a próxima saída da conta faça a migração.
   */
  private readonly sensitiveSessionPrefixes: ReadonlyArray<string> = [
    'user:',
    'preferences:',
    'friendSettings:',
    'search:',
    'socialLinks:',
    'chats:',
    'chat:',
    'rooms:',
    'room:',
    'direct_',
    'discovery:public_profiles:uids:',
  ];

  private readonly noisyPrefixes: ReadonlyArray<string> = ['validation:'];

  constructor(
    private readonly cachePersistence: CachePersistenceService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly privacyDebug: PrivacyDebugLoggerService
  ) {
    this.log('Serviço inicializado.', {
      maxMemoryEntries: this.maxMemoryEntries,
    });
  }

  // ---------------------------------------------------------------------------
  // Escrita
  // ---------------------------------------------------------------------------

  set<T>(
    key: string,
    data: T,
    ttl?: number,
    opts?: { persist?: boolean }
  ): void {
    const normalizedKey = this.normalizeKey(key);
    if (!normalizedKey) return;

    const expiration = this.resolveExpiration(ttl);
    const persist = opts?.persist ?? !HOT_KEYS.has(normalizedKey);
    const previous = this.cache.get(normalizedKey);

    if (
      previous &&
      this.deepEqual(previous.data, data) &&
      previous.expiration === expiration
    ) {
      this.touchMemoryEntry(normalizedKey, previous);
      this.traceWrite(normalizedKey, expiration, persist, 'skip:same');
      return;
    }

    this.bumpRevision(normalizedKey);
    this.writeMemoryEntry(normalizedKey, { data, expiration });
    this.traceWrite(normalizedKey, expiration, persist, 'set');

    if (persist) {
      this.cachePersistence
        .setPersistentEntry(normalizedKey, data, expiration)
        .subscribe({
          error: (error) =>
            this.safeHandle(
              error,
              `CacheService.setPersistentEntry("${normalizedKey}")`
            ),
        });
    }

    if (HOT_KEYS.has(normalizedKey)) {
      this.mirrorHotKeyToLocalStorage(normalizedKey, data);
    }
  }

  /**
   * Compatibilidade semântica para consumidores antigos.
   * Não substitui AuthSessionService ou CurrentUserStoreService.
   */
  setUser(
    uid: string,
    user: IUserDados,
    ttl: number = this.defaultTTL
  ): void {
    const normalizedUid = this.normalizeKey(uid);
    if (!normalizedUid) return;

    const userKey = this.userKey(normalizedUid);
    this.set(userKey, user, ttl, { persist: true });
    this.set('currentUserUid', normalizedUid, undefined, { persist: false });

    this.logKey(userKey, `setUser → ${userKey} + currentUserUid`);
  }

  update<T>(
    key: string,
    data: T,
    ttl?: number,
    opts?: { persist?: boolean }
  ): void {
    const normalizedKey = this.normalizeKey(key);
    if (!normalizedKey) return;

    const current = this.cache.get(normalizedKey);
    if (!current || this.isExpired(current.expiration)) {
      if (current) {
        this.bumpRevision(normalizedKey);
        this.cache.delete(normalizedKey);
        this.inFlightGets.delete(normalizedKey);
        this.cleanupRevisionIfIdle(normalizedKey);
      }

      this.logKey(
        normalizedKey,
        `update → chave inexistente ou expirada: "${normalizedKey}"`
      );
      return;
    }

    const persist = opts?.persist ?? !HOT_KEYS.has(normalizedKey);
    const expiration = this.hasPositiveTTL(ttl)
      ? Date.now() + (ttl as number)
      : current.expiration;

    if (
      this.deepEqual(current.data, data) &&
      current.expiration === expiration
    ) {
      this.touchMemoryEntry(normalizedKey, current);
      return;
    }

    this.bumpRevision(normalizedKey);
    this.writeMemoryEntry(normalizedKey, { data, expiration });
    this.traceWrite(normalizedKey, expiration, persist, 'update');

    if (persist) {
      this.cachePersistence
        .setPersistentEntry(normalizedKey, data, expiration)
        .subscribe({
          error: (error) =>
            this.safeHandle(
              error,
              `CacheService.update.setPersistentEntry("${normalizedKey}")`
            ),
        });
    }

    if (HOT_KEYS.has(normalizedKey)) {
      this.mirrorHotKeyToLocalStorage(normalizedKey, data);
    }
  }

  // ---------------------------------------------------------------------------
  // Leitura
  // ---------------------------------------------------------------------------

  get<T>(key: string): Observable<T | null> {
    const normalizedKey = this.normalizeKey(key);
    if (!normalizedKey) return of(null);

    this.logKey(normalizedKey, `get → "${normalizedKey}"`);

    const memoryValue = this.readValidMemory<T>(normalizedKey);
    if (memoryValue.hit) {
      return of(memoryValue.value);
    }

    const inFlight = this.inFlightGets.get(normalizedKey);
    if (inFlight) {
      return inFlight as Observable<T | null>;
    }

    const token = this.createReadToken(normalizedKey);

    const request$ = defer(() => {
      this.startActiveRead(normalizedKey);
      return this.cachePersistence.getPersistentEntry<T>(normalizedKey);
    }).pipe(
      switchMap((persisted) => {
        if (!this.isReadTokenCurrent(normalizedKey, token)) {
          return of(this.readCurrentMemoryValue<T>(normalizedKey));
        }

        if (persisted) {
          this.writeMemoryEntry(normalizedKey, {
            data: persisted.value,
            expiration: persisted.expiresAt,
          });

          return of(persisted.value);
        }

        return of(null);
      }),
      catchError((error) => {
        this.safeHandle(error, `CacheService.get("${normalizedKey}")`);
        return of(null);
      }),
      finalize(() => {
        const current = this.inFlightGets.get(normalizedKey);
        if (current === request$) {
          this.inFlightGets.delete(normalizedKey);
        }

        this.finishActiveRead(normalizedKey);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.inFlightGets.set(normalizedKey, request$);
    return request$;
  }

  /**
   * Snapshot síncrono limitado a memória e HOT_KEYS do localStorage.
   * Não lê IndexedDB; consumidores persistentes devem usar `get()`.
   */
  getSync<T>(key: string): T | null {
    const normalizedKey = this.normalizeKey(key);
    if (!normalizedKey) return null;

    const memoryValue = this.readValidMemory<T>(normalizedKey);
    if (memoryValue.hit) {
      return memoryValue.value;
    }

    if (!HOT_KEYS.has(normalizedKey)) {
      return null;
    }

    try {
      const raw = localStorage.getItem(normalizedKey);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Existência e ciclo de vida
  // ---------------------------------------------------------------------------

  has(key: string): boolean {
    const normalizedKey = this.normalizeKey(key);
    if (!normalizedKey) return false;

    return this.readValidMemory(normalizedKey).hit;
  }

  delete(key: string): void {
    const normalizedKey = this.normalizeKey(key);
    if (!normalizedKey) return;

    this.bumpRevision(normalizedKey);
    const existedInMemory = this.cache.delete(normalizedKey);
    this.inFlightGets.delete(normalizedKey);
    this.cleanupRevisionIfIdle(normalizedKey);

    this.cachePersistence.deletePersistent(normalizedKey).subscribe({
      error: (error) =>
        this.safeHandle(
          error,
          `CacheService.deletePersistent("${normalizedKey}")`
        ),
    });

    if (HOT_KEYS.has(normalizedKey)) {
      this.removeLocalStorageKeyBestEffort(normalizedKey);
    }

    if (existedInMemory) {
      this.logKey(normalizedKey, `delete → "${normalizedKey}" (ok)`);
    } else if (this.logNoopDeletes) {
      this.logKey(normalizedKey, `delete → "${normalizedKey}" (noop)`);
    }
  }

  /**
   * Limpa somente a camada em memória.
   * O nome é mantido por compatibilidade; persistência exige métodos explícitos.
   */
  clear(): void {
    this.mutationGeneration += 1;
    this.cache.clear();
    this.inFlightGets.clear();
    this.keyRevisions.clear();
    this.log('clear → memória limpa.');
  }

  /**
   * Limpa caches locais ligados à sessão anterior.
   */
  clearSensitiveSessionCache$(): Observable<void> {
    this.mutationGeneration += 1;

    const exactKeys = this.sensitiveSessionExactKeys
      .map((key) => this.normalizeKey(key))
      .filter(Boolean);
    const prefixes = this.sensitiveSessionPrefixes
      .map((prefix) => this.normalizeKey(prefix))
      .filter(Boolean);

    for (const key of exactKeys) {
      this.bumpRevision(key);
      this.cache.delete(key);
      this.inFlightGets.delete(key);
      this.removeLocalStorageKeyBestEffort(key);
      this.cleanupRevisionIfIdle(key);
    }

    const memoryDeletedByPrefix = prefixes.map((prefix) => ({
      prefix: this.maskCacheKey(prefix),
      deleted: this.deleteMemoryByPrefix(prefix),
    }));

    const persistentPrefixDeletes$ = prefixes.map((prefix) =>
      this.cachePersistence.deletePersistentByPrefix(prefix).pipe(
        map((deleted) => ({
          prefix: this.maskCacheKey(prefix),
          deleted,
        }))
      )
    );

    return forkJoin([
      this.cachePersistence.deletePersistentMany(exactKeys),
      ...persistentPrefixDeletes$,
    ]).pipe(
      map(([exactDeleted, ...prefixDeleted]) => {
        this.log('clearSensitiveSessionCache$ → concluído', {
          exactDeleted,
          memoryDeletedByPrefix,
          persistentDeletedByPrefix: prefixDeleted,
        });

        return void 0;
      }),
      catchError((error) => {
        this.safeHandle(
          error,
          'CacheService.clearSensitiveSessionCache$'
        );
        return of(void 0);
      })
    );
  }

  removeExpired(): void {
    const now = Date.now();
    const expiredKeys = Array.from(this.cache.entries())
      .filter(([, item]) =>
        item.expiration !== null && item.expiration < now
      )
      .map(([key]) => key);

    for (const key of expiredKeys) {
      this.bumpRevision(key);
      this.cache.delete(key);
      this.inFlightGets.delete(key);
      this.cleanupRevisionIfIdle(key);
    }

    if (expiredKeys.length) {
      this.log(`removeExpired → ${expiredKeys.length} itens removidos.`);
    }
  }

  enableAutoCleanup(interval = 60_000): () => void {
    this.log(`AutoCleanup ON (${interval}ms).`);
    const id = setInterval(() => this.removeExpired(), interval);

    return () => {
      clearInterval(id);
      this.log('AutoCleanup OFF.');
    };
  }

  // ---------------------------------------------------------------------------
  // Utilitários internos
  // ---------------------------------------------------------------------------

  private readValidMemory<T>(key: string):
    | { hit: true; value: T }
    | { hit: false; value: null } {
    const item = this.cache.get(key);

    if (!item) {
      return { hit: false, value: null };
    }

    if (this.isExpired(item.expiration)) {
      this.bumpRevision(key);
      this.cache.delete(key);
      this.inFlightGets.delete(key);
      this.cleanupRevisionIfIdle(key);
      return { hit: false, value: null };
    }

    this.touchMemoryEntry(key, item);
    return { hit: true, value: item.data as T };
  }

  private readCurrentMemoryValue<T>(key: string): T | null {
    const current = this.readValidMemory<T>(key);
    return current.hit ? current.value : null;
  }

  private writeMemoryEntry<T>(key: string, item: CacheItem<T>): void {
    this.cache.delete(key);
    this.cache.set(key, item as CacheItem<unknown>);
    this.enforceMemoryLimit();
  }

  private touchMemoryEntry(key: string, item: CacheItem<unknown>): void {
    this.cache.delete(key);
    this.cache.set(key, item);
  }

  private enforceMemoryLimit(): void {
    let evicted = 0;

    while (this.cache.size > this.maxMemoryEntries) {
      const candidate = Array.from(this.cache.keys()).find(
        (key) => !HOT_KEYS.has(key)
      );

      if (!candidate) break;

      this.bumpRevision(candidate);
      this.cache.delete(candidate);
      this.inFlightGets.delete(candidate);
      this.cleanupRevisionIfIdle(candidate);
      evicted += 1;
    }

    if (evicted > 0) {
      this.log(`LRU → ${evicted} entrada(s) removida(s) da memória.`, {
        size: this.cache.size,
        maxMemoryEntries: this.maxMemoryEntries,
      });
    }
  }

  private normalizeMemoryLimit(value: unknown): number {
    const normalized =
      typeof value === 'number' && Number.isFinite(value)
        ? Math.floor(value)
        : 250;

    return Math.max(HOT_KEYS.size, normalized);
  }

  private startActiveRead(key: string): void {
    this.activeReadCounts.set(key, (this.activeReadCounts.get(key) ?? 0) + 1);
  }

  private finishActiveRead(key: string): void {
    const remaining = (this.activeReadCounts.get(key) ?? 1) - 1;

    if (remaining > 0) {
      this.activeReadCounts.set(key, remaining);
      return;
    }

    this.activeReadCounts.delete(key);
    this.cleanupRevisionIfIdle(key);
  }

  private cleanupRevisionIfIdle(key: string): void {
    if (this.cache.has(key)) return;
    if (this.inFlightGets.has(key)) return;
    if ((this.activeReadCounts.get(key) ?? 0) > 0) return;

    this.keyRevisions.delete(key);
  }

  private createReadToken(key: string): CacheReadToken {
    return {
      generation: this.mutationGeneration,
      revision: this.keyRevisions.get(key) ?? 0,
    };
  }

  private isReadTokenCurrent(
    key: string,
    token: CacheReadToken
  ): boolean {
    return (
      token.generation === this.mutationGeneration &&
      token.revision === (this.keyRevisions.get(key) ?? 0)
    );
  }

  private bumpRevision(key: string): number {
    const revision = (this.keyRevisions.get(key) ?? 0) + 1;
    this.keyRevisions.set(key, revision);
    return revision;
  }

  private resolveExpiration(ttl?: number): number | null {
    return this.hasPositiveTTL(ttl)
      ? Date.now() + (ttl as number)
      : null;
  }

  private hasPositiveTTL(ttl?: number): ttl is number {
    return typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0;
  }

  private normalizeKey(key: string): string {
    return String(key ?? '').trim();
  }

  private userKey(uid: string): string {
    return `user:${this.normalizeKey(uid)}`;
  }

  private isExpired(expiration: number | null): boolean {
    return expiration !== null && Date.now() > expiration;
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;

    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }

  private deleteMemoryByPrefix(prefix: string): number {
    const matchingKeys = Array.from(this.cache.keys()).filter((key) =>
      key.startsWith(prefix)
    );

    for (const key of matchingKeys) {
      this.bumpRevision(key);
      this.cache.delete(key);
      this.inFlightGets.delete(key);
      this.cleanupRevisionIfIdle(key);
    }

    return matchingKeys.length;
  }

  private mirrorHotKeyToLocalStorage(key: string, data: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch {
      // O cache em memória permanece funcional.
    }
  }

  private removeLocalStorageKeyBestEffort(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // noop
    }
  }

  // ---------------------------------------------------------------------------
  // Debug e tratamento centralizado
  // ---------------------------------------------------------------------------

  private traceWrite(
    key: string,
    expiration: number | null,
    persist: boolean,
    operation: 'set' | 'update' | 'skip:same'
  ): void {
    this.logKey(key, `${operation} → "${key}"`, {
      expiration,
      persist,
    });
  }

  private log(message: string, extra?: unknown): void {
    this.privacyDebug.log('cache', `CacheService: ${message}`, extra);
  }

  private logKey(key: string, message: string, extra?: unknown): void {
    if (!this.privacyDebug.canLog('cache')) return;

    const isNoisy = this.noisyPrefixes.some((prefix) =>
      key.startsWith(prefix)
    );

    if (isNoisy && !this.isNoisyLoggingEnabled()) return;

    const safeKey = this.maskCacheKey(key);
    this.log(message.split(key).join(safeKey), extra);
  }

  private isNoisyLoggingEnabled(): boolean {
    try {
      return localStorage.getItem('CACHE_LOG_NOISY_KEYS') === '1';
    } catch {
      return false;
    }
  }

  private maskCacheKey(key: string): string {
    return this.normalizeKey(key)
      .split(/([:/?&=|,]+)/)
      .map((token) => this.maskCacheToken(token))
      .join('');
  }

  private maskCacheToken(token: string): string {
    const value = token.trim();
    if (!value) return token;

    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      const [name, domain] = value.split('@');
      return name && domain ? `${name.slice(0, 1)}***@${domain}` : 'masked-email';
    }

    if (/^direct_[a-f0-9]{32,128}$/i.test(value)) {
      return `${value.slice(0, 13)}...${value.slice(-6)}`;
    }

    if (/^[A-Za-z0-9_-]{18,80}$/.test(value)) {
      return value.length > 8
        ? `${value.slice(0, 4)}...${value.slice(-4)}`
        : 'masked';
    }

    return token;
  }

  private safeHandle(error: unknown, context: string): void {
    try {
      const normalized = error instanceof Error
        ? error
        : new Error(String(error ?? 'unknown error'));
      const wrapped = new Error(
        `[${this.maskCacheKey(context)}] ${normalized.message}`
      ) as Error & {
        original?: unknown;
        skipUserNotification?: boolean;
      };

      wrapped.original = error;
      wrapped.skipUserNotification = true;
      this.globalErrorHandler.handleError(wrapped);
    } catch {
      // noop
    }
  }

  // ---------------------------------------------------------------------------
  // Conveniências e compatibilidade
  // ---------------------------------------------------------------------------

  markAsNotFound(key: string, ttl = 30_000): void {
    this.set(`notFound:${this.normalizeKey(key)}`, true, ttl, {
      persist: false,
    });
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
    this.log('DEBUG', {
      size: this.size(),
      maxMemoryEntries: this.maxMemoryEntries,
      revisionEntries: this.keyRevisions.size,
      activeReads: this.activeReadCounts.size,
      keys: this.keys().map((key) => this.maskCacheKey(key)),
    });
  }

  /**
   * Compatibilidade legada. Novos fluxos devem usar AuthSessionService e
   * CurrentUserStoreService como fontes canônicas.
   */
  syncCurrentUserWithUid(userData: IUserDados): void {
    if (!userData?.uid) return;

    const key = this.userKey(userData.uid);
    this.set(key, userData, this.defaultTTL, { persist: true });
    this.set('currentUser', userData, undefined, { persist: false });
    this.set('currentUserUid', userData.uid, undefined, { persist: false });

    this.logKey(
      key,
      `syncCurrentUserWithUid → ${key} + currentUser + currentUserUid`
    );
  }
}
