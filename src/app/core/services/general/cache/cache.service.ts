// src/app/core/services/general/cache/cache.service.ts
// Serviço de cache:
// - memória (rápido)
// - IndexedDB (persistência assíncrona)
// - store NgRx como fallback/compat
//
// Importante:
// - CacheService NÃO é orquestrador de domínio.
// - Ele não deve ser a fonte de verdade de current user.
// - Métodos como syncCurrentUserWithUid e setUser existem por compatibilidade.
import { Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import {
  Observable,
  of,
  switchMap,
  take,
  defer,
  catchError,
  finalize,
  map,
  shareReplay,
} from 'rxjs';

import { AppState } from 'src/app/store/states/app.state';
import { selectCacheItem } from 'src/app/store/selectors/cache.selectors';

import { CachePersistenceService } from './cache-persistence.service';
import { IUserDados } from '../../../interfaces/iuser-dados';

import { environment } from 'src/environments/environment';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';

interface CacheItem<T> {
  data: T;
  expiration: number | null;
}

const HOT_KEYS: ReadonlySet<string> = new Set(['currentUser', 'currentUserUid']);

@Injectable({ providedIn: 'root' })
export class CacheService {
  private cache: Map<string, CacheItem<any>> = new Map();
  private readonly defaultTTL = 300_000;
  private readonly verbose = !environment.production;
  private readonly logNoopDeletes = false;
  private readonly inFlightGets = new Map<string, Observable<any>>();
  private readonly noisyPrefixes: ReadonlyArray<string> = ['validation:'];
  private readonly traceUserKeys = !environment.production;

  private readonly tracedUserKeyPrefixes: ReadonlyArray<string> = [
    'user:',
  ];

  private readonly tracedExactKeys: ReadonlySet<string> = new Set([
    'currentUser',
    'currentUserUid',
  ]);

  constructor(
    private store: Store<AppState>,
    private cachePersistence: CachePersistenceService,
    private globalErrorHandler: GlobalErrorHandlerService,
  ) {
    this.log('Serviço inicializado.');
  }

  // ===========================================================================
  // SETTERS
  // ===========================================================================

set<T>(key: string, data: T, ttl?: number, opts?: { persist?: boolean }): void {
  const normalizedKey = this.normalizeKey(key);
  const expiration = ttl ? Date.now() + ttl : null;

  /**
   * HOT_KEYS:
   * - ficam em memória
   * - espelham no localStorage
   * - por default não vão para IndexedDB
   */
  const persist = opts?.persist ?? !HOT_KEYS.has(normalizedKey);

  const prev = this.cache.get(normalizedKey);
  const sameData = prev ? this.deepEqual(prev.data, data) : false;
  const sameExp = prev ? prev.expiration === expiration : false;

  if (sameData && sameExp) {
    this.traceUserWrite(normalizedKey, data, {
      stage: 'skip:sameData+sameExp',
      expiration,
      persist,
    });
    return;
  }

  this.traceUserWrite(normalizedKey, data, {
    stage: 'before:set',
    expiration,
    persist,
    hadPrev: !!prev,
    sameData,
    sameExp,
  });

  this.cache.set(normalizedKey, { data, expiration });
  this.logKey(normalizedKey, `set → "${normalizedKey}"`, { expiration, persist });

  if (persist) {
    this.cachePersistence.setPersistent(normalizedKey, data).subscribe({
      next: () => {
        this.traceUserWrite(normalizedKey, data, {
          stage: 'after:setPersistent:ok',
          expiration,
          persist,
        });
      },
      error: (err) => {
        this.traceUserWrite(normalizedKey, data, {
          stage: 'after:setPersistent:error',
          expiration,
          persist,
          error: err,
        });
        this.safeHandle(err, `CacheService.setPersistent("${normalizedKey}")`);
      },
    });
  }

  if (HOT_KEYS.has(normalizedKey)) {
    this.mirrorHotKeyToLocalStorage(normalizedKey, data);
    this.traceUserWrite(normalizedKey, data, {
      stage: 'after:mirrorHotKeyToLocalStorage',
      expiration,
      persist,
    });
  }
}

  /**
   * Compat semântico:
   * - persiste user:{uid}
   * - espelha currentUserUid
   *
   * Não despacha para store.
   * Não deve ser tratado como source of truth do perfil.
   */
  setUser(uid: string, user: IUserDados, ttl: number = this.defaultTTL): void {
    const normalizedUid = (uid ?? '').toString().trim();
    if (!normalizedUid) return;

    const userKey = this.userKey(normalizedUid);
    this.set(userKey, user, ttl, { persist: true });
    this.set('currentUserUid', normalizedUid, undefined, { persist: false });

    this.logKey(userKey, `setUser → ${userKey} + currentUserUid`);
  }

  update<T>(key: string, data: T, ttl?: number, opts?: { persist?: boolean }): void {
    const normalizedKey = this.normalizeKey(key);
    const persist = opts?.persist ?? !HOT_KEYS.has(normalizedKey);

    const current = this.cache.get(normalizedKey);
    if (!current) {
      this.logKey(normalizedKey, `update → chave inexistente: "${normalizedKey}"`);
      return;
    }

    const newExpiration = ttl ? Date.now() + ttl : current.expiration;
    const sameData = this.deepEqual(current.data, data);
    const sameExp = current.expiration === newExpiration;

    if (sameData && sameExp) return;

    this.cache.set(normalizedKey, { data, expiration: newExpiration });
    this.logKey(normalizedKey, `update → "${normalizedKey}"`, {
      expiration: newExpiration,
      persist,
    });

    if (persist) {
      this.cachePersistence.setPersistent(normalizedKey, data).subscribe({
        next: () => {},
        error: (err) => this.safeHandle(err, `CacheService.update.setPersistent("${normalizedKey}")`),
      });
    }

    if (HOT_KEYS.has(normalizedKey)) {
      this.mirrorHotKeyToLocalStorage(normalizedKey, data);
    }
  }

  // ===========================================================================
  // GETTERS
  // ===========================================================================

  get<T>(key: string): Observable<T | null> {
    const normalizedKey = this.normalizeKey(key);
    this.logKey(normalizedKey, `get → "${normalizedKey}"`);

    const mem = this.cache.get(normalizedKey);
    if (mem) {
      if (this.isExpired(mem.expiration)) {
        this.cache.delete(normalizedKey);
      } else {
        return of(mem.data as T);
      }
    }

    const inflight = this.inFlightGets.get(normalizedKey);
    if (inflight) return inflight as Observable<T | null>;

    const rehydrateMemory = (k: string, value: any): void => {
      const expiration = HOT_KEYS.has(k) ? null : Date.now() + this.defaultTTL;
      this.cache.set(k, { data: value, expiration });
      if (HOT_KEYS.has(k)) {
        this.mirrorHotKeyToLocalStorage(k, value);
      }
    };

    const req$ = defer(() => this.cachePersistence.getPersistent<T>(normalizedKey)).pipe(
      switchMap((persisted) => {
        if (persisted !== null && persisted !== undefined) {
          rehydrateMemory(normalizedKey, persisted);
          return of(persisted);
        }

        return this.store.select(selectCacheItem(normalizedKey)).pipe(
          take(1),
          map((storeData) => {
            if (storeData !== undefined && storeData !== null) {
              rehydrateMemory(normalizedKey, storeData);
              return storeData as T;
            }
            return null;
          })
        );
      }),
      catchError((err) => {
        this.safeHandle(err, `CacheService.get("${normalizedKey}")`);
        return of(null);
      }),
      finalize(() => {
        this.inFlightGets.delete(normalizedKey);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.inFlightGets.set(normalizedKey, req$);
    return req$;
  }

  getSync<T>(key: string): T | null {
    const normalizedKey = this.normalizeKey(key);

    const mem = this.cache.get(normalizedKey);
    if (mem && !this.isExpired(mem.expiration)) return mem.data as T;

    try {
      const raw = localStorage.getItem(normalizedKey);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // EXISTENCE / LIFECYCLE
  // ===========================================================================

  has(key: string): boolean {
    const normalizedKey = this.normalizeKey(key);
    const cached = this.cache.get(normalizedKey);

    if (!cached) return false;
    if (cached.expiration && cached.expiration < Date.now()) {
      this.cache.delete(normalizedKey);
      return false;
    }

    return true;
  }

  delete(key: string): void {
    const normalizedKey = this.normalizeKey(key);
    const existedInMemory = this.cache.delete(normalizedKey);

    this.cachePersistence.deletePersistent(normalizedKey).subscribe({
      next: () => {},
      error: (err) => this.safeHandle(err, `CacheService.deletePersistent("${normalizedKey}")`),
    });

    if (HOT_KEYS.has(normalizedKey)) {
      try {
        localStorage.removeItem(normalizedKey);
      } catch {
        // noop
      }
    }

    if (existedInMemory) {
      this.logKey(normalizedKey, `delete → "${normalizedKey}" (ok)`);
    } else if (this.logNoopDeletes) {
      this.logKey(normalizedKey, `delete → "${normalizedKey}" (noop)`);
    }
  }

  clear(): void {
    this.cache.clear();
    this.log('clear → memória limpa.');
  }

  removeExpired(): void {
    const now = Date.now();
    const expiredKeys = Array.from(this.cache.entries())
      .filter(([_, item]) => item.expiration && item.expiration < now)
      .map(([key]) => key);

    expiredKeys.forEach((key) => this.cache.delete(key));

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

  // ===========================================================================
  // UTILITÁRIOS
  // ===========================================================================

  private normalizeKey(key: string): string {
    return (key ?? '').toString().trim();
  }

  private userKey(uid: string): string {
    return `user:${(uid ?? '').toString().trim()}`;
  }

  private isExpired(expiration: number | null): boolean {
    return expiration !== null && Date.now() > expiration;
  }

  private deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }

  private shouldTraceUserKey(key: string): boolean {
  if (!this.traceUserKeys) return false;

  if (this.tracedExactKeys.has(key)) return true;
  return this.tracedUserKeyPrefixes.some((prefix) => key.startsWith(prefix));
}

private summarizeUserLikeData(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;

  const value = data as Record<string, unknown>;
  return {
    uid: value['uid'] ?? null,
    email: value['email'] ?? null,
    emailVerified: value['emailVerified'] ?? null,
    nickname: value['nickname'] ?? null,
    profileCompleted: value['profileCompleted'] ?? null,
    role: value['role'] ?? null,
  };
}

    private traceUserWrite(key: string, data: unknown, meta?: Record<string, unknown>): void {
      if (!this.shouldTraceUserKey(key)) return;

      const stack = new Error(`[CacheService][TRACE] ${key}`).stack
        ?.split('\n')
        .slice(1, 7);

      // eslint-disable-next-line no-console
      console.log(`[CacheService][TRACE] ${key}`, {
        meta,
        summary: this.summarizeUserLikeData(data),
        stack,
      });
    }

  private mirrorHotKeyToLocalStorage(key: string, data: any): void {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch {
      // noop
    }
  }

  private log(message: string, extra?: any): void {
    if (!this.verbose) return;
    // eslint-disable-next-line no-console
    extra !== undefined
      ? console.log(`[CacheService] ${message}`, extra)
      : console.log(`[CacheService] ${message}`);
  }

  private logKey(key: string, message: string, extra?: any): void {
    if (!this.verbose) return;

    const allowNoisy = this.isNoisyLoggingEnabled();
    const isNoisy = this.noisyPrefixes.some((prefix) => key.startsWith(prefix));

    if (isNoisy && !allowNoisy) return;
    this.log(message, extra);
  }

  private isNoisyLoggingEnabled(): boolean {
    try {
      return localStorage.getItem('CACHE_LOG_NOISY_KEYS') === '1';
    } catch {
      return false;
    }
  }

  private safeHandle(err: unknown, context: string): void {
    try {
      const e = err instanceof Error ? err : new Error(String(err ?? 'unknown error'));
      this.globalErrorHandler.handleError(new Error(`[${context}] ${e.message}`));
    } catch {
      // noop
    }
  }

  // ===========================================================================
  // Conveniências
  // ===========================================================================

  markAsNotFound(key: string, ttl = 30_000): void {
    this.set(`notFound:${this.normalizeKey(key)}`, true, ttl, { persist: false });
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
    this.log('DEBUG', { size: this.size(), keys: this.keys() });
  }

  /**
   * Compat legado.
   * Mantém:
   * - user:{uid} persistente
   * - currentUser HOT_KEY
   * - currentUserUid HOT_KEY
   *
   * Não despacha para NgRx.
   * Não deve ser chamado junto com CurrentUserStore.set no mesmo fluxo novo.
   */
  syncCurrentUserWithUid(userData: IUserDados): void {
    if (!userData?.uid) return;

    const key = this.userKey(userData.uid);

    this.set(key, userData, this.defaultTTL, { persist: true });
    this.set('currentUser', userData, undefined, { persist: false });
    this.set('currentUserUid', userData.uid, undefined, { persist: false });

    this.logKey(key, `syncCurrentUserWithUid → ${key} + currentUser + currentUserUid`);
  }
} // Linha 406, fim do cache.service.ts
