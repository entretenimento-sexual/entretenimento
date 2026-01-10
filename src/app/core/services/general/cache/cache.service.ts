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
 * - `expiration = null` significa sem expiração (até limpar memória).
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

  /**
   * Controle de verbosidade:
   * - Coloque `false` em produção ou proteja via environment.
   * - Ex.: importar `environment` e usar `!environment.production`.
   */
  private readonly verbose = true;

  constructor(
    private store: Store<AppState>,
    private cachePersistence: CachePersistenceService, // IndexedDB
  ) {
    this.log('Serviço inicializado.');
  }

  // ===========================================================================
  // SETTERS
  // ===========================================================================

  /**
   * Adiciona/atualiza um item no cache (idempotente).
   * - Memória (imediato)
   * - IndexedDB (assíncrono)
   * - (Opcional) localStorage para HOT_KEYS (leitura síncrona com getSync)
   *
   * Idempotência: se os dados **e** a expiração não mudarem, a operação é "noop"
   * (evita spam de log e escrita redundante em IndexedDB/localStorage).
   */
  set<T>(key: string, data: T, ttl?: number, opts?: { persist?: boolean }): void {
    const normalizedKey = this.normalizeKey(key);
    const expiration = ttl ? Date.now() + ttl : null;
    const persist = opts?.persist ?? true;

    const prev = this.cache.get(normalizedKey);
    const sameData = prev ? this.deepEqual(prev.data, data) : false;
    const sameExp = prev ? prev.expiration === expiration : false;

    if (sameData && sameExp) {
      // this.log(`set (noop) → "${normalizedKey}"`);
      return;
    }

    this.log(`set → "${normalizedKey}"`, { expiration });
    this.cache.set(normalizedKey, { data, expiration });

    if (persist) {
      this.cachePersistence.setPersistent(normalizedKey, data).subscribe(() => { });
    }

    if (HOT_KEYS.has(normalizedKey)) {
      this.mirrorHotKeyToLocalStorage(normalizedKey, data);
    }
  }

  /**
   * API semântica para armazenar usuário atual (escolha usar **esta** OU `syncCurrentUserWithUid`).
   * - Grava `user:{uid}` (uid normalizado para lower-case na **chave**)
   * - Atualiza `currentUserUid` (mantém o UID como veio)
   * - Dispara Store (NgRx) apenas se houve mudança
   *
   * ⚠️ Recomenda-se **não** chamar `syncCurrentUserWithUid` no mesmo fluxo para evitar duplicidades.
   */
  setUser(uid: string, user: IUserDados, ttl: number = this.defaultTTL): void {
    const userKey = this.userKey(uid);
    const prev = this.cache.get(userKey);
    const changed = !prev || !this.deepEqual(prev.data, user);

    this.set(userKey, user, ttl);
    this.set('currentUserUid', uid, ttl); // 🔥 HOT_KEY (mantém forma original do UID)

    if (changed) {
      this.store.dispatch(setCache({ key: userKey, value: user }));
      this.store.dispatch(setCache({ key: 'currentUserUid', value: uid }));
      this.log(`setUser → ${userKey} + currentUserUid (store dispatch)`);
    } else {
      this.log(`setUser → ${userKey} + currentUserUid (unchanged)`);
    }
  }

  /**
   * Atualiza um item já existente (mantém/renova TTL).
   * Idempotente: se o valor não mudou e a expiração é a mesma, não persiste novamente.
   */
  update<T>(key: string, data: T, ttl?: number, opts?: { persist?: boolean }): void {
    const normalizedKey = this.normalizeKey(key);
    const persist = opts?.persist ?? true;

    if (!this.cache.has(normalizedKey)) {
      this.log(`update → chave inexistente: "${normalizedKey}"`);
      return;
    }

    const newExpiration = ttl
      ? Date.now() + ttl
      : this.cache.get(normalizedKey)!.expiration;

    const prev = this.cache.get(normalizedKey)!;
    const sameData = this.deepEqual(prev.data, data);
    const sameExp = prev.expiration === newExpiration;

    if (sameData && sameExp) return;

    this.cache.set(normalizedKey, { data, expiration: newExpiration });
    this.log(`update → "${normalizedKey}"`, { expiration: newExpiration });

    if (persist) {
      this.cachePersistence.setPersistent(normalizedKey, data).subscribe(() => { });
    }

    if (HOT_KEYS.has(normalizedKey)) {
      this.mirrorHotKeyToLocalStorage(normalizedKey, data);
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
    this.log(`get → "${normalizedKey}"`);

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
            this.mirrorHotKeyToLocalStorage(normalizedKey, persist);
          }
          return of(persist);
        }

        this.log('get → não achou no IndexedDB, consultando Store...');
        // 3) Store (NgRx)
        return this.store.select(selectCacheItem(normalizedKey)).pipe(
          take(1),
          switchMap((storeData) => {
            if (storeData !== undefined && storeData !== null) {
              this.cache.set(normalizedKey, { data: storeData, expiration: null });
              if (HOT_KEYS.has(normalizedKey)) {
                this.mirrorHotKeyToLocalStorage(normalizedKey, storeData);
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

    this.log(`delete → "${normalizedKey}" (${existed ? 'ok' : 'não existia'})`);
  }

  /** Limpa somente memória (rápido). */
  clear(): void {
    this.cache.clear();
    this.log('clear → memória limpa.');
  }

  /** Remove itens expirados (memória). */
  removeExpired(): void {
    const now = Date.now();
    const expiredKeys = Array.from(this.cache.entries())
      .filter(([_, item]) => item.expiration && item.expiration < now)
      .map(([k]) => k);

    expiredKeys.forEach((k) => this.cache.delete(k));
    if (expiredKeys.length) {
      this.log(`removeExpired → ${expiredKeys.length} itens removidos.`);
    }
  }

  /** Habilita limpeza automática de expirados (memória). */
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

  /** Normaliza chaves para consistência (trim). */
  private normalizeKey(key: string): string {
    return key.trim();
  }

  /** Monta chave de usuário com UID em lower-case (evita duplicidade por casing). */
  private userKey(uid: string): string {
    return `user:${uid.trim().toLowerCase()}`;
  }

  /** Verifica expiração. */
  private isExpired(expiration: number | null): boolean {
    return expiration !== null && Date.now() > expiration;
  }

  /** Comparação rasa via JSON (suficiente para dados plain). */
  private deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      // Fallback caso haja referência circular (não esperado aqui)
      return false;
    }
  }

  /** Espelha HOT_KEYS em localStorage (uso exclusivo para chaves do conjunto HOT_KEYS). */
  private mirrorHotKeyToLocalStorage(key: string, data: any): void {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch {
      // silencioso (privacy mode / quotas / etc.)
    }
  }

  /** Log condicional. */
  private log(message: string, extra?: any): void {
    if (!this.verbose) return;
    if (extra !== undefined) {
      // eslint-disable-next-line no-console
      console.log(`[CacheService] ${message}`, extra);
    } else {
      // eslint-disable-next-line no-console
      console.log(`[CacheService] ${message}`);
    }
  }

  // ===========================================================================
  // Conveniências
  // ===========================================================================

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
    this.log('DEBUG', {
      size: this.size(),
      keys: this.keys(),
    });
  }

  // ===========================================================================
  // Bootstrap helpers (use um OU outro, não os dois)
  // ===========================================================================

  /**
   * Sincroniza dados do usuário com UID (usado em bootstraps/refresh).
   * - `user:{uid}` (lower-case na chave)
   * - `currentUser` (espelho HOT_KEY)
   * - `currentUserUid` (HOT_KEY → espelho em localStorage)
   *
   * ⚠️ Use esta função para "semeadura" completa em bootstraps/refresh.
   * ⚠️ Evite chamar junto com `setUser` no mesmo fluxo.
   */
  syncCurrentUserWithUid(userData: IUserDados): void {
    const key = this.userKey(userData.uid);
    const prev = this.cache.get(key);
    const changed = !prev || !this.deepEqual(prev.data, userData);

    this.set(key, userData, this.defaultTTL);
    this.set('currentUser', userData, this.defaultTTL);          // 🔥 HOT_KEY
    this.set('currentUserUid', userData.uid, this.defaultTTL);   // 🔥 HOT_KEY

    if (changed) {
      this.store.dispatch(setCache({ key, value: userData }));
      this.store.dispatch(setCache({ key: 'currentUser', value: userData }));
      this.store.dispatch(setCache({ key: 'currentUserUid', value: userData.uid }));
      this.log(`syncCurrentUserWithUid → ${key} + currentUser + currentUserUid (store dispatch)`);
    } else {
      this.log(`syncCurrentUserWithUid → ${key} + currentUser + currentUserUid (unchanged)`);
    }
  }
}
