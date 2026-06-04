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
  forkJoin,
} from 'rxjs';

import { AppState } from 'src/app/store/states/app.state';
import { selectCacheItem } from 'src/app/store/selectors/cache.selectors';

import { CachePersistenceService } from './cache-persistence.service';
import { IUserDados } from '../../../interfaces/iuser-dados';

import { environment } from 'src/environments/environment';
import { PrivacyDebugLoggerService } from '@core/services/privacy/privacy-debug-logger.service';
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
  private readonly traceUserKeys = this.isCacheTraceEnabled();
  private readonly logNoopDeletes = false;
  private readonly inFlightGets = new Map<string, Observable<any>>();
  private readonly noisyPrefixes: ReadonlyArray<string> = ['validation:'];
 
  private readonly tracedUserKeyPrefixes: ReadonlyArray<string> = [
    'user:',
  ];

  private readonly tracedExactKeys: ReadonlySet<string> = new Set([
    'currentUser',
    'currentUserUid',
  ]);

  /**
 * Chaves exatas que não devem sobreviver ao encerramento de sessão.
 */
private readonly sensitiveSessionExactKeys: ReadonlyArray<string> = [
  'currentUser',
  'currentUserUid',
  'discovery:public_profiles:all',
];

/**
 * Prefixos que podem guardar dados ligados a usuário, perfil, chat,
 * vínculos sociais ou descoberta.
 *
 * Decisão de segurança:
 * - em logout, preferimos recarregar dados depois;
 * - não vale manter rastros locais de perfis vistos, chats ou social links.
 */
private readonly sensitiveSessionPrefixes: ReadonlyArray<string> = [
  'user:',
  'socialLinks:',
  'chats:',
  'chat:',
  'rooms:',
  'room:',
  'direct_',
  'discovery:public_profiles:uids:',
];

  constructor(
    private store: Store<AppState>,
    private cachePersistence: CachePersistenceService,
    private globalErrorHandler: GlobalErrorHandlerService,
    private privacyDebug: PrivacyDebugLoggerService,
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

  /**
 * Limpa caches locais sensíveis ao encerrar sessão.
 *
 * Remove:
 * - HOT_KEYS do usuário atual;
 * - perfis cacheados em user:{uid};
 * - social links;
 * - caches de chat/salas;
 * - caches de descoberta por UID;
 * - parte persistente no IndexedDB;
 * - espelhos em localStorage.
 *
 * Observação:
 * - este método não substitui signOut;
 * - ele só limpa rastros locais da sessão anterior.
 */
clearSensitiveSessionCache$(): Observable<void> {
  const exactKeys = this.sensitiveSessionExactKeys.map((key) =>
    this.normalizeKey(key)
  );

  const prefixes = this.sensitiveSessionPrefixes.map((prefix) =>
    this.normalizeKey(prefix)
  );

  for (const key of exactKeys) {
    this.cache.delete(key);
    this.removeLocalStorageKeyBestEffort(key);
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
    catchError((err) => {
      this.safeHandle(err, 'CacheService.clearSensitiveSessionCache$');
      return of(void 0);
    })
  );
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

private isCacheTraceEnabled(): boolean {
  if (environment.production) {
    return false;
  }

  /**
   * Trace de cache exige o canal geral de cache ativo.
   * Assim evitamos um segundo sistema de log paralelo.
   */
  if (!this.privacyDebug.canLog('cache')) {
    return false;
  }

  if (environment.privacyLogging?.allowCacheTrace !== true) {
    return false;
  }

  /**
   * Segunda trava manual.
   *
   * Motivo:
   * - mesmo em dev/staging, trace de user/cache é sensível;
   * - só deve aparecer quando o dev ativar conscientemente no navegador.
   */
  try {
    return localStorage.getItem('CACHE_TRACE_USER_KEYS') === '1';
  } catch {
    return false;
  }
}

private canLogSensitiveConsoleData(): boolean {
  if (environment.production) {
    return false;
  }

  if (environment.privacyLogging?.allowSensitiveConsoleData !== true) {
    return false;
  }

  /**
   * Segunda trava manual para dados pessoais em claro.
   */
  try {
    return localStorage.getItem('ALLOW_SENSITIVE_CONSOLE_DATA') === '1';
  } catch {
    return false;
  }
}

private canIncludeCacheTraceStack(): boolean {
  if (!this.traceUserKeys) {
    return false;
  }

  if (environment.privacyLogging?.includeStackTrace !== true) {
    return false;
  }

  try {
    return localStorage.getItem('CACHE_TRACE_STACK') === '1';
  } catch {
    return false;
  }
}

private maskCacheText(value: unknown): string {
  const text = String(value ?? '');

  if (!text) {
    return text;
  }

  return text
    .split(/([:/?&=|,()"'\s]+)/)
    .map((token) => this.maskCacheToken(token))
    .join('');
}

private maskUid(value: unknown): string | null {
  const uid = String(value ?? '').trim();

  if (!uid) {
    return null;
  }

  if (this.canLogSensitiveConsoleData()) {
    return uid;
  }

  if (uid.length <= 8) {
    return 'masked';
  }

  return `${uid.slice(0, 4)}...${uid.slice(-4)}`;
}

private maskEmail(value: unknown): string | null {
  const email = String(value ?? '').trim();

  if (!email) {
    return null;
  }

  if (this.canLogSensitiveConsoleData()) {
    return email;
  }

  const [name, domain] = email.split('@');

  if (!name || !domain) {
    return 'masked-email';
  }

  return `${name.slice(0, 1)}***@${domain}`;
}

private maskTextPresence(value: unknown): string | null {
  const text = String(value ?? '').trim();

  if (!text) {
    return null;
  }

  return this.canLogSensitiveConsoleData() ? text : 'present';
}

private looksLikeFirebaseUid(value: string): boolean {
  /**
   * Firebase UID costuma ser uma string longa, sem espaços,
   * com letras, números, "_" ou "-".
   *
   * Esse filtro evita mascarar textos comuns de log.
   */
  return /^[A-Za-z0-9_-]{18,80}$/.test(value);
}

private looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

private looksLikeDirectChatId(value: string): boolean {
  /**
   * Chats diretos também são identificadores sensíveis:
   * revelam vínculo entre usuários ou canal de conversa.
   */
  return /^direct_[a-f0-9]{32,128}$/i.test(value);
}

private maskDirectChatId(value: string): string {
  if (this.canLogSensitiveConsoleData()) {
    return value;
  }

  return `${value.slice(0, 13)}...${value.slice(-6)}`;
}

private maskCacheToken(token: string): string {
  const safeToken = String(token ?? '').trim();

  if (!safeToken) {
    return token;
  }

  if (this.looksLikeEmail(safeToken)) {
    return this.maskEmail(safeToken) ?? 'masked-email';
  }

  if (this.looksLikeDirectChatId(safeToken)) {
    return this.maskDirectChatId(safeToken);
  }

  if (this.looksLikeFirebaseUid(safeToken)) {
    return this.maskUid(safeToken) ?? 'masked';
  }

  return token;
}

private maskCacheKey(key: string): string {
  const safeKey = this.normalizeKey(key);

  if (!safeKey) {
    return safeKey;
  }

  /**
   * Divide preservando separadores comuns de chave:
   * - socialLinks:{uid}
   * - chats:{uid}
   * - discovery:public_profiles:uids:{uid}
   * - presence_leader:{uid}
   *
   * Os separadores continuam iguais; apenas tokens sensíveis são mascarados.
   */
  return safeKey
    .split(/([:/?&=|,]+)/)
    .map((token) => this.maskCacheToken(token))
    .join('');
}

private maskMessageForKey(key: string, message: string): string {
  const rawKey = this.normalizeKey(key);
  const safeKey = this.maskCacheKey(rawKey);

  if (!rawKey || rawKey === safeKey) {
    return message;
  }

  return message.split(rawKey).join(safeKey);
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
  if (!data || typeof data !== 'object') {
    return data;
  }

  const value = data as Record<string, unknown>;

  return {
    uid: this.maskUid(value['uid']),
    email: this.maskEmail(value['email']),
    emailVerified: value['emailVerified'] ?? null,
    nickname: this.maskTextPresence(value['nickname']),
    profileCompleted: value['profileCompleted'] ?? null,
    role: this.maskTextPresence(value['role']),
  };
}

  private traceUserWrite(
    key: string,
    data: unknown,
    meta?: Record<string, unknown>
  ): void {
    if (!this.shouldTraceUserKey(key)) {
      return;
    }

    const safeKey = this.maskCacheKey(key);

    const stack = this.canIncludeCacheTraceStack()
      ? new Error(`[CacheService][TRACE] ${safeKey}`).stack
          ?.split('\n')
          .slice(1, 7)
      : undefined;

this.privacyDebug.log(
  'cache',
  `CacheService TRACE ${safeKey}`,
  {
    meta,
    summary: this.summarizeUserLikeData(data),
    ...(stack ? { stack } : {}),
  },
  'debug'
);
  }

  private removeLocalStorageKeyBestEffort(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // noop
  }
}

private deleteMemoryByPrefix(prefix: string): number {
  const safePrefix = this.normalizeKey(prefix);

  if (!safePrefix) {
    return 0;
  }

  const matchingKeys = Array.from(this.cache.keys()).filter((key) =>
    key.startsWith(safePrefix)
  );

  for (const key of matchingKeys) {
    this.cache.delete(key);
  }

  return matchingKeys.length;
}

  private mirrorHotKeyToLocalStorage(key: string, data: any): void {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch {
      // noop
    }
  }

private log(message: string, extra?: unknown): void {
  this.privacyDebug.log('cache', `CacheService: ${message}`, extra);
}

private logKey(key: string, message: string, extra?: unknown): void {
  if (!this.privacyDebug.canLog('cache')) {
    return;
  }

  const allowNoisy = this.isNoisyLoggingEnabled();
  const isNoisy = this.noisyPrefixes.some((prefix) => key.startsWith(prefix));

  if (isNoisy && !allowNoisy) {
    return;
  }

  this.log(this.maskMessageForKey(key, message), extra);
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
    const safeContext = this.maskCacheText(context);
    const safeMessage = this.maskCacheText(e.message);

    this.globalErrorHandler.handleError(new Error(`[${safeContext}] ${safeMessage}`));
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
} // Linha 838, fim do cache.service.ts
