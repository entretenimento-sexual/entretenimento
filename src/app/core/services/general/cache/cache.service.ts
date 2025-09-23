// src/app/core/services/general/cache.service.ts
import { Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable, of, switchMap, take } from 'rxjs';

import { AppState } from 'src/app/store/states/app.state';
import { setCache } from 'src/app/store/actions/cache.actions';
import { selectCacheItem } from 'src/app/store/selectors/cache.selectors';

import { CachePersistenceService } from './cache-persistence.service';
import { IUserDados } from '../../../interfaces/iuser-dados';

/**
 * Item interno do cache em memória.
 * - `expiration = null` significa sem expiração.
 */
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

  /** TTL default (5 min) para itens que você quiser expirar */
  private readonly defaultTTL = 300_000;

  constructor(
    private store: Store<AppState>,
    private cachePersistence: CachePersistenceService, // IndexedDB
  ) {
    console.log('[CacheService] Serviço inicializado.');
  }

  // ===========================================================================
  // SETTERS
  // ===========================================================================

  /**
   * Adiciona/atualiza um item no cache.
   * - Memória (imediato)
   * - IndexedDB (assíncrono)
   * - (Opcional) localStorage para HOT_KEYS (leitura síncrona com getSync)
   */
  set<T>(key: string, data: T, ttl?: number): void {
    const normalizedKey = this.normalizeKey(key);
    const expiration = ttl ? Date.now() + ttl : null;

    console.log(`[CacheService] set → "${normalizedKey}"`, { data, expiration });
    this.cache.set(normalizedKey, { data, expiration });

    // IndexedDB (durável)
    this.cachePersistence.setPersistent(normalizedKey, data).subscribe(() => {
      // log de confirmação
    });

    // Espelho síncrono apenas para chaves quentes
    if (HOT_KEYS.has(normalizedKey)) {
      try {
        localStorage.setItem(normalizedKey, JSON.stringify(data));
      } catch { /* no-op (privacy, quotas, modo privado etc.) */ }
    }
  }

  /**
   * API semântica para armazenar usuário atual, alinhada às grandes plataformas.
   * - Grava `user:{uid}`
   * - Atualiza `currentUserUid`
   * - Dispara Store (NgRx)
   */
  setUser(uid: string, user: IUserDados, ttl: number = this.defaultTTL): void {
    const normalizedUserKey = this.normalizeKey(`user:${uid}`);
    this.set(normalizedUserKey, user, ttl);
    this.set('currentUserUid', uid, ttl); // 🔥 HOT_KEY

    this.store.dispatch(setCache({ key: normalizedUserKey, value: user }));
    this.store.dispatch(setCache({ key: 'currentUserUid', value: uid }));
    console.log(`[CacheService] setUser → user:${uid} + currentUserUid`);
  }

  /**
   * Atualiza um item já existente (mantém/renova TTL).
   */
  update<T>(key: string, data: T, ttl?: number): void {
    const normalizedKey = this.normalizeKey(key);

    if (!this.cache.has(normalizedKey)) {
      console.log(`[CacheService] update → chave inexistente: "${normalizedKey}"`);
      return;
    }

    const newExpiration = ttl
      ? Date.now() + ttl
      : this.cache.get(normalizedKey)!.expiration;

    this.cache.set(normalizedKey, { data, expiration: newExpiration });
    console.log(`[CacheService] update → "${normalizedKey}"`, { data, expiration: newExpiration });

    // Mantém persistência/espelho como em set()
    this.cachePersistence.setPersistent(normalizedKey, data).subscribe(() => { });
    if (HOT_KEYS.has(normalizedKey)) {
      try { localStorage.setItem(normalizedKey, JSON.stringify(data)); } catch { }
    }
  }

  // ===========================================================================
  // GETTERS
  // ===========================================================================

  /**
   * API principal de leitura: retorna um Observable que tenta, **nesta ordem**:
   * 1) Memória
   * 2) IndexedDB
   * 3) Store (NgRx)
   *
   * Obs.: Não busca Firestore aqui – este serviço é só de cache.
   */
  get<T>(key: string): Observable<T | null> {
    const normalizedKey = this.normalizeKey(key);
    console.log(`[CacheService] get → "${normalizedKey}"`);

    // 1) Memória
    const mem = this.cache.get(normalizedKey);
    if (mem && !this.isExpired(mem.expiration)) {
      return of(mem.data as T);
    }

    // 2) IndexedDB
    return this.cachePersistence.getPersistent<T>(normalizedKey).pipe(
      switchMap((persist) => {
        if (persist !== null && persist !== undefined) {
          // Reidrata memória e espelho (se hot key)
          this.cache.set(normalizedKey, { data: persist, expiration: null });
          if (HOT_KEYS.has(normalizedKey)) {
            try { localStorage.setItem(normalizedKey, JSON.stringify(persist)); } catch { }
          }
          return of(persist);
        }

        console.log('[CacheService] get → não achou no IndexedDB, consultando Store...');
        // 3) Store (NgRx)
        return this.store.select(selectCacheItem(normalizedKey)).pipe(
          take(1),
          switchMap((storeData) => {
            if (storeData !== undefined && storeData !== null) {
              this.cache.set(normalizedKey, { data: storeData, expiration: null });
              if (HOT_KEYS.has(normalizedKey)) {
                try { localStorage.setItem(normalizedKey, JSON.stringify(storeData)); } catch { }
              }
              return of(storeData as T);
            }
            // Nada encontrado – cabe ao chamador decidir se vai ao Firestore.
            return of(null);
          })
        );
      })
    );
  }

  /**
   * Leitura **síncrona** (só para casos críticos de bootstrap):
   * - Tenta memória
   * - Fallback localStorage (espelho apenas para HOT_KEYS)
   *
   * Obs.: IndexedDB é assíncrono e **não** é usado aqui.
   */
  getSync<T>(key: string): T | null {
    const normalizedKey = this.normalizeKey(key);

    // Memória
    const mem = this.cache.get(normalizedKey);
    if (mem && !this.isExpired(mem.expiration)) {
      return mem.data as T;
    }

    // localStorage (espelho para HOT_KEYS)
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

  /** Verifica existência e validade (memória). */
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
   * Remove um item do cache:
   * - Memória
   * - IndexedDB
   * - localStorage (se for HOT_KEY)
   */
  delete(key: string): void {
    const normalizedKey = this.normalizeKey(key);
    const existed = this.cache.delete(normalizedKey);

    // remove do IndexedDB
    this.cachePersistence.deletePersistent(normalizedKey).subscribe(() => { });

    // remove espelho localStorage se hot key
    if (HOT_KEYS.has(normalizedKey)) {
      try { localStorage.removeItem(normalizedKey); } catch { }
    }

    console.log(`[CacheService] delete → "${normalizedKey}" (${existed ? 'ok' : 'não existia'})`);
  }

  /** Limpa somente memória (rápido). */
  clear(): void {
    this.cache.clear();
    console.log('[CacheService] clear → memória limpa.');
  }

  /** Remove itens expirados (memória). */
  removeExpired(): void {
    const now = Date.now();
    const expiredKeys = Array.from(this.cache.entries())
      .filter(([_, item]) => item.expiration && item.expiration < now)
      .map(([k]) => k);

    expiredKeys.forEach((k) => this.cache.delete(k));
    if (expiredKeys.length) {
      console.log(`[CacheService] removeExpired → ${expiredKeys.length} itens removidos.`);
    }
  }

  /** Habilita limpeza automática de expirados (memória). */
  enableAutoCleanup(interval = 60_000): () => void {
    console.log(`[CacheService] AutoCleanup ON (${interval}ms).`);
    const id = setInterval(() => this.removeExpired(), interval);
    return () => {
      clearInterval(id);
      console.log('[CacheService] AutoCleanup OFF.');
    };
  }

  // ===========================================================================
  // UTILITÁRIOS
  // ===========================================================================

  /** Normaliza chaves para consistência. */
  private normalizeKey(key: string): string {
    return key.trim();
  }

  /** Verifica expiração. */
  private isExpired(expiration: number | null): boolean {
    return expiration !== null && Date.now() > expiration;
  }

  /**
   * Marca um item como "não encontrado" por um TTL curto (mitiga re-buscas consecutivas).
   * Padrão de plataformas grandes para evitar DDoS interno em endpoints.
   */
  markAsNotFound(key: string, ttl = 30_000): void {
    this.set(`notFound:${this.normalizeKey(key)}`, true, ttl);
  }

  /** Testa se um item está marcado como "não encontrado". */
  isNotFound(key: string): boolean {
    return this.has(`notFound:${this.normalizeKey(key)}`);
  }

  /** Lista as chaves atuais em memória (debug). */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /** Quantidade de itens em memória (debug). */
  size(): number {
    return this.cache.size;
  }

  /** Loga estado interno (debug). */
  debug(): void {
    console.log('[CacheService] DEBUG', {
      size: this.size(),
      keys: this.keys(),
    });
  }

  /**
   * Sincroniza dados do usuário com UID (usado em bootstraps/refresh).
   * - `user:{uid}`
   * - `currentUser`
   * - `currentUserUid` (HOT_KEY → espelho em localStorage)
   */
  syncCurrentUserWithUid(userData: IUserDados): void {
    const uid = userData.uid.trim().toLowerCase();
    this.set(`user:${uid}`, userData, this.defaultTTL);
    this.set('currentUser', userData, this.defaultTTL);      // 🔥 HOT_KEY
    this.set('currentUserUid', userData.uid, this.defaultTTL); // 🔥 HOT_KEY
    console.log(`[CacheService] syncCurrentUserWithUid → uid=${uid}`);
  }
}
