// src/app/core/services/general/cache/cache.service.ts
// Serviço de Cache em Memória com IndexedDB e Store (NgRx)
// - Memória = rápida, pode expirar (TTL)
// - IndexedDB = persistência (assíncrona)
// - Store = fallback/compat (não é fonte primária de persistência)
//
// Observação importante:
// - delete() é idempotente. "não existia" NÃO é falha.
// - Reidratação via IndexedDB/Store aplica TTL na memória para evitar crescimento infinito.
// - HOT_KEYS são espelhadas no localStorage para leitura síncrona no bootstrap.
//
// PATCH (2026):
// - get() agora coalesce requests simultâneas (inFlight) por key => reduz logs e I/O.
// - HOT_KEYS por default NÃO persistem em IndexedDB (já estão no localStorage).
// - Logs de chaves "barulhentas" podem ser suprimidos (ex.: validation:*), com toggle.
import { Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import {
  Observable, of, switchMap, take, defer,
  catchError, finalize, map, shareReplay
} from 'rxjs';

import { AppState } from 'src/app/store/states/app.state';
import { setCache } from 'src/app/store/actions/cache.actions';
import { selectCacheItem } from 'src/app/store/selectors/cache.selectors';

import { CachePersistenceService } from './cache-persistence.service';
import { IUserDados } from '../../../interfaces/iuser-dados';

import { environment } from 'src/environments/environment';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';

interface CacheItem<T> {
  data: T;
  expiration: number | null;
}

/** Chaves "quentes" que exigem leitura síncrona (ex.: durante bootstrap). */
const HOT_KEYS: ReadonlySet<string> = new Set(['currentUser', 'currentUserUid']);

@Injectable({ providedIn: 'root' })
export class CacheService {
  /** Cache em memória (rápido e efêmero) */
  private cache: Map<string, CacheItem<any>> = new Map();

  /** TTL default (5 min) para itens de memória (quando aplicável) */
  private readonly defaultTTL = 300_000;

  /**
   * Controle de verbosidade:
   * - Em produção: false
   * - Em dev: true (mas pode suprimir chaves barulhentas)
   */
  private readonly verbose = !environment.production;

  /**
   * Quando true, loga deletes "noop" (chave não existia em memória).
   * Útil só para diagnósticos bem específicos.
   */
  private readonly logNoopDeletes = false;

  /**
   * Coalescing de leituras:
   * - Evita 2+ gets simultâneos para a mesma key baterem no IndexedDB/Store.
   * - Cada key fica "em voo" até completar e então sai do Map (finalize).
   */
  private readonly inFlightGets = new Map<string, Observable<any>>();

  /**
   * Suprime logs de chaves muito frequentes (ex.: validation:*).
   * Você pode habilitar logs dessas chaves via:
   *   localStorage.setItem('CACHE_LOG_NOISY_KEYS', '1')
   */
  private readonly noisyPrefixes: ReadonlyArray<string> = ['validation:'];

  constructor(
    private store: Store<AppState>,
    private cachePersistence: CachePersistenceService, // IndexedDB
    private globalErrorHandler: GlobalErrorHandlerService,
  ) {
    this.log('Serviço inicializado.');
  }

  // ===========================================================================
  // SETTERS
  // ===========================================================================

  /**
   * Adiciona/atualiza um item no cache (idempotente).
   * - Memória (imediato)
   * - IndexedDB (assíncrono, se persist=true)
   * - localStorage (somente HOT_KEYS)
   *
   * Idempotência:
   * - Se valor e expiração não mudam, não faz nada.
   */
  set<T>(key: string, data: T, ttl?: number, opts?: { persist?: boolean }): void {
    const normalizedKey = this.normalizeKey(key);
    const expiration = ttl ? Date.now() + ttl : null;

    // PATCH: HOT_KEYS por default NÃO persistem em IndexedDB (já vão p/ localStorage)
    const persist = opts?.persist ?? !HOT_KEYS.has(normalizedKey);

    const prev = this.cache.get(normalizedKey);
    const sameData = prev ? this.deepEqual(prev.data, data) : false;
    const sameExp = prev ? prev.expiration === expiration : false;

    if (sameData && sameExp) return;

    this.cache.set(normalizedKey, { data, expiration });
    this.logKey(normalizedKey, `set → "${normalizedKey}"`, { expiration, persist });

    if (persist) {
      // Persistência é best-effort (não quebra UX se falhar).
      this.cachePersistence.setPersistent(normalizedKey, data).subscribe({
        next: () => { },
        error: (err) => this.safeHandle(err, `CacheService.setPersistent("${normalizedKey}")`)
      });
    }

    if (HOT_KEYS.has(normalizedKey)) {
      this.mirrorHotKeyToLocalStorage(normalizedKey, data);
    }
  }

  /**
   * API semântica para armazenar usuário atual (use esta OU syncCurrentUserWithUid).
   * - user:{uid} (chave estável)
   * - currentUserUid (HOT_KEY)
   *
   * Obs.: UID é identificador canônico; NÃO aplicamos lower-case no UID.
   */
  setUser(uid: string, user: IUserDados, ttl: number = this.defaultTTL): void {
    const userKey = this.userKey(uid);
    const prev = this.cache.get(userKey);
    const changed = !prev || !this.deepEqual(prev.data, user);

    // user:{uid} pode persistir
    this.set(userKey, user, ttl, { persist: true });

    // HOT_KEY sem TTL e sem persist (default do set já faz isso)
    this.set('currentUserUid', uid);

    if (changed) {
      this.store.dispatch(setCache({ key: userKey, value: user }));
      this.store.dispatch(setCache({ key: 'currentUserUid', value: uid }));
      this.logKey(userKey, `setUser → ${userKey} + currentUserUid (store dispatch)`);
    } else {
      this.logKey(userKey, `setUser → ${userKey} + currentUserUid (unchanged)`);
    }
  }

  /**
   * Atualiza item existente (mantém/renova TTL).
   * Idempotente: se valor e expiração são iguais, não persiste.
   */
  update<T>(key: string, data: T, ttl?: number, opts?: { persist?: boolean }): void {
    const normalizedKey = this.normalizeKey(key);

    // PATCH: HOT_KEYS por default NÃO persistem
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
    this.logKey(normalizedKey, `update → "${normalizedKey}"`, { expiration: newExpiration, persist });

    if (persist) {
      this.cachePersistence.setPersistent(normalizedKey, data).subscribe({
        next: () => { },
        error: (err) => this.safeHandle(err, `CacheService.update.setPersistent("${normalizedKey}")`)
      });
    }

    if (HOT_KEYS.has(normalizedKey)) {
      this.mirrorHotKeyToLocalStorage(normalizedKey, data);
    }
  }

  // ===========================================================================
  // GETTERS
  // ===========================================================================

  /**
   * Leitura principal (Observable):
   * 1) Memória (respeita TTL)
   * 2) IndexedDB (rehidrata memória com TTL, exceto HOT_KEYS)
   * 3) Store (rehidrata memória com TTL, exceto HOT_KEYS)
   *
   * PATCH:
   * - Coalesce in-flight: múltiplas chamadas simultâneas para a mesma key compartilham 1 pipeline.
   */
  get<T>(key: string): Observable<T | null> {
    const normalizedKey = this.normalizeKey(key);
    this.logKey(normalizedKey, `get → "${normalizedKey}"`);

    // 1) Memória (aplica expiração)
    const mem = this.cache.get(normalizedKey);
    if (mem) {
      if (this.isExpired(mem.expiration)) {
        this.cache.delete(normalizedKey);
      } else {
        return of(mem.data as T);
      }
    }

    // Coalesce: se já existe request em voo, devolve o mesmo Observable
    const inflight = this.inFlightGets.get(normalizedKey);
    if (inflight) return inflight as Observable<T | null>;

    // Helper: reidrata com TTL na memória (evita crescer infinito).
    const rehydrateMemory = (k: string, value: any): void => {
      const expiration = HOT_KEYS.has(k) ? null : (Date.now() + this.defaultTTL);
      this.cache.set(k, { data: value, expiration });
      if (HOT_KEYS.has(k)) this.mirrorHotKeyToLocalStorage(k, value);
    };

    const req$ = defer(() => this.cachePersistence.getPersistent<T>(normalizedKey)).pipe(
      switchMap((persisted) => {
        // 2) IndexedDB
        if (persisted !== null && persisted !== undefined) {
          rehydrateMemory(normalizedKey, persisted);
          return of(persisted);
        }

        // 3) Store (NgRx)
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
        // remove do in-flight (mesmo em erro)
        this.inFlightGets.delete(normalizedKey);
      }),
      // shareReplay garante que chamadas simultâneas compartilham o mesmo resultado
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.inFlightGets.set(normalizedKey, req$);
    return req$;
  }

  /**
   * Leitura síncrona (bootstrap):
   * - memória
   * - localStorage (somente HOT_KEYS, espelhadas)
   */
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

  /**
   * Remove item:
   * - Memória
   * - IndexedDB (best-effort)
   * - localStorage (se HOT_KEY)
   *
   * Importante:
   * - "não existia em memória" é normal e NÃO deve parecer erro.
   * - Ainda assim removemos do IndexedDB, porque pode existir lá.
   */
  delete(key: string): void {
    const normalizedKey = this.normalizeKey(key);
    const existedInMemory = this.cache.delete(normalizedKey);

    this.cachePersistence.deletePersistent(normalizedKey).subscribe({
      next: () => { },
      error: (err) => this.safeHandle(err, `CacheService.deletePersistent("${normalizedKey}")`)
    });

    if (HOT_KEYS.has(normalizedKey)) {
      try { localStorage.removeItem(normalizedKey); } catch { }
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
      .map(([k]) => k);

    expiredKeys.forEach((k) => this.cache.delete(k));
    if (expiredKeys.length) this.log(`removeExpired → ${expiredKeys.length} itens removidos.`);
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
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
  }

  private mirrorHotKeyToLocalStorage(key: string, data: any): void {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch { }
  }

  /**
   * Logs:
   * - verbose controla se loga em dev
   * - chaves barulhentas (validation:*) são suprimidas por padrão
   */
  private log(message: string, extra?: any): void {
    if (!this.verbose) return;
    // eslint-disable-next-line no-console
    extra !== undefined ? console.log(`[CacheService] ${message}`, extra) : console.log(`[CacheService] ${message}`);
  }

  private logKey(key: string, message: string, extra?: any): void {
    if (!this.verbose) return;

    // Suprime keys barulhentas, a menos que o toggle esteja ligado
    const allowNoisy = this.isNoisyLoggingEnabled();
    const isNoisy = this.noisyPrefixes.some((p) => key.startsWith(p));
    if (isNoisy && !allowNoisy) return;

    this.log(message, extra);
  }

  private isNoisyLoggingEnabled(): boolean {
    try { return localStorage.getItem('CACHE_LOG_NOISY_KEYS') === '1'; } catch { return false; }
  }

  /**
   * Routing centralizado (best-effort):
   * - não quebra fluxo de cache por falhas de persistência
   * - registra no handler global (se você quiser silenciar totalmente, comente esta chamada)
   */
  private safeHandle(err: unknown, context: string): void {
    try {
      const e = err instanceof Error ? err : new Error(String(err ?? 'unknown error'));
      this.globalErrorHandler.handleError(new Error(`[${context}] ${e.message}`));
    } catch {
      // último fallback: não deixa estourar dentro do CacheService
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
   * Semeadura completa para bootstrap/refresh.
   * - user:{uid} (TTL + IndexedDB)
   * - currentUser (HOT_KEY localStorage)
   * - currentUserUid (HOT_KEY localStorage)
   *
   * Obs.: Evite chamar junto de setUser no mesmo fluxo.
   */
  syncCurrentUserWithUid(userData: IUserDados): void {
    const key = this.userKey(userData.uid);
    const prev = this.cache.get(key);
    const changed = !prev || !this.deepEqual(prev.data, userData);

    // user:{uid} persiste
    this.set(key, userData, this.defaultTTL, { persist: true });

    // HOT_KEYS sem TTL e sem persist (default)
    this.set('currentUser', userData);
    this.set('currentUserUid', userData.uid);

    if (changed) {
      this.store.dispatch(setCache({ key, value: userData }));
      this.store.dispatch(setCache({ key: 'currentUser', value: userData }));
      this.store.dispatch(setCache({ key: 'currentUserUid', value: userData.uid }));
      this.logKey(key, `syncCurrentUserWithUid → ${key} + currentUser + currentUserUid (store dispatch)`);
    } else {
      this.logKey(key, `syncCurrentUserWithUid → ${key} + currentUser + currentUserUid (unchanged)`);
    }
  }
}
