// src/app/core/services/user-profile/user-social-links.service.ts
// =============================================================================
// USER SOCIAL LINKS SERVICE
//
// Responsabilidade:
// - Ler, observar em tempo real, salvar e remover links sociais do perfil.
// - Opcionalmente manter um “espelho público” em /public_social_links/{uid}.
//
// Padrões aplicados (estilo “grandes plataformas”):
// - Observable-first (API pública por Observables)
// - Injection Context garantido (FirestoreContextService)
// - Gate de auth para evitar listeners/leituras sem autenticação (por padrão)
// - Coalescência (dedupe) de leituras e listeners em voo
// - Cache leve (SWR para leitura única; cache para watchers)
//
// Erros:
// - Sempre roteados para GlobalErrorHandlerService
// - Notificação visual opcional (ErrorNotificationService) com throttle
// =============================================================================

import { Injectable } from '@angular/core';
import {
  doc,
  getDoc,
  writeBatch,
  deleteField,
  serverTimestamp,
  docSnapshots,
  type Firestore,
} from '@angular/fire/firestore';

import type { User } from 'firebase/auth';

import { Observable, combineLatest, concat, of, throwError } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  finalize,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { IUserSocialLinks } from '../../interfaces/interfaces-user-dados/iuser-social-links';
import { FirestoreService } from '../data-handling/legacy/firestore.service';
import { FirestoreContextService } from '../data-handling/firestore/core/firestore-context.service';
import { CacheService } from '../general/cache/cache.service';

import { AuthSessionService } from '../autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';

export type SocialLinksOptions = {
  notifyOnError?: boolean;

  /**
   * true  -> upsert /public_social_links/{uid}
   * false -> delete /public_social_links/{uid}
   * undefined -> não altera o espelho
   */
  publishToPublic?: boolean;

  /**
   * Leitura/watch sem auth só se suas rules permitirem.
   * Se false/undefined, o service NÃO inicia getDoc/docSnapshots sem auth.
   */
  allowAnonymousRead?: boolean;

  /**
   * Cache persistente (IndexedDB) pode ser indesejável para dados pessoais em device compartilhado.
   * Por padrão, este service usa cache EM MEMÓRIA (persist: false).
   * Se quiser permitir persistência, set true.
   */
  persistCache?: boolean;
};

type CacheMeta = { cachedAt: number };

type CacheState<T> =
  | { kind: 'miss' }
  | { kind: 'fresh'; value: T }
  | { kind: 'stale'; value: T };

@Injectable({ providedIn: 'root' })
export class UserSocialLinksService {
  private readonly db: Firestore;

  // TTL lógico do cache (não depende do TTL do CacheService).
  private readonly cacheTtlMs = 10 * 60 * 1000; // 10 min

  // Throttle de toast
  private lastNotifyAt = 0;

  // Coalescência:
  // - 1 getDoc por UID enquanto estiver em voo
  private readonly inFlightReads = new Map<string, Observable<IUserSocialLinks | null>>();

  // - 1 docSnapshots por UID enquanto houver subscribers
  private readonly inFlightWatches = new Map<string, Observable<IUserSocialLinks | null>>();

  constructor(
    private readonly firestoreService: FirestoreService,
    private readonly firestoreCtx: FirestoreContextService,
    private readonly cache: CacheService,
    private readonly session: AuthSessionService,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly notifier: ErrorNotificationService,
  ) {
    this.db = this.firestoreService.getFirestoreInstance();
  }

  // =============================================================================
  // API PÚBLICA
  // =============================================================================

  /**
   * Leitura “one-shot” com SWR:
   * - Se cache STALE: emite cache e revalida em background.
   * - Por padrão exige auth (inclusive para retornar cache).
   */
  getSocialLinks(uid: string, options: SocialLinksOptions = {}): Observable<IUserSocialLinks | null> {
    const safeUid = (uid ?? '').trim();
    if (!safeUid) return of(null);

    const gate$ = options.allowAnonymousRead ? of(true) : this.requireAuth$();

    return gate$.pipe(
      switchMap(() => this.getCacheState$(safeUid, options)),
      switchMap((state) => {
        if (state.kind === 'fresh') return of(state.value);

        if (state.kind === 'stale') {
          const cached$ = of(state.value);

          const refresh$ = this.getOrCreateFirestoreRead$(safeUid, options).pipe(
            // se refresh falhar, não derruba a UI quando já temos cache
            catchError(() => of(state.value)),
          );

          return concat(cached$, refresh$).pipe(
            distinctUntilChanged((a, b) => this.deepEqual(a, b))
          );
        }

        return this.getOrCreateFirestoreRead$(safeUid, options);
      }),
      catchError((err) => this.handleError(err, 'getSocialLinks', options, null))
    );
  }

  /**
   * Watch realtime (docSnapshots):
   * - Por padrão: NÃO inicia listener sem auth.
   * - Se allowAnonymousRead=true: inicia listener direto (se rules permitirem).
   * - Se usuário deslogar: emite null e encerra listener automaticamente (switchMap).
   *
   * Observação:
   * - Ideal para telas que precisam refletir mudanças em tempo real.
   * - Coalescência: múltiplos subscribers compartilham 1 listener.
   */
  watchSocialLinks(uid: string, options: SocialLinksOptions = {}): Observable<IUserSocialLinks | null> {
    const safeUid = (uid ?? '').trim();
    if (!safeUid) return of(null);

    // Se rules permitem leitura anônima, não precisamos do gate de auth.
    if (options.allowAnonymousRead) {
      return this.getOrCreateFirestoreWatch$(safeUid, options).pipe(
        catchError((err) => this.handleError(err, 'watchSocialLinks', options, null))
      );
    }

    // Gate “vivo”: quando auth muda, cancela/reinicia listener automaticamente.
    // - ready$ garante que não decidimos antes da restauração do Auth.
    return this.session.ready$.pipe(
      switchMap((ready) => (ready ? this.session.authUser$ : of(null))),
      map((u) => u?.uid ?? null),
      distinctUntilChanged(),
      switchMap((authUid) => {
        // Sem auth: não inicia listener; não retorna cache (evita “vazar” dado privado).
        if (!authUid) return of(null);

        // Com auth: inicia listener compartilhado por UID.
        return this.getOrCreateFirestoreWatch$(safeUid, options);
      }),
      catchError((err) => this.handleError(err, 'watchSocialLinks', options, null))
    );
  }

  /**
   * Salva links sociais (privado) e opcionalmente espelha no público.
   * - Exige owner (authUid === targetUid)
   */
  saveSocialLinks(uid: string, links: IUserSocialLinks, options: SocialLinksOptions = {}): Observable<void> {
    const safeUid = (uid ?? '').trim();
    if (!safeUid) return throwError(() => new Error('[UserSocialLinks] uid inválido em saveSocialLinks'));

    const safeLinks = (links ?? {}) as IUserSocialLinks;

    return this.requireOwner$(safeUid).pipe(
      switchMap(() => this.commitBatchSave$(safeUid, safeLinks, options.publishToPublic)),
      tap(() => {
        // Atualiza cache local pós-commit (melhor UX)
        this.setCache(safeUid, safeLinks, options);
        // Invalida leituras “one-shot” em voo
        this.invalidateInFlightReads(safeUid);
      }),
      catchError((err) => this.handleError(err, 'saveSocialLinks', options, undefined as any, true))
    );
  }

  /**
   * Remove uma key.
   * - Exige owner
   */
  removeLink(uid: string, linkKey: keyof IUserSocialLinks, options: SocialLinksOptions = {}): Observable<void> {
    const safeUid = (uid ?? '').trim();
    if (!safeUid) return throwError(() => new Error('[UserSocialLinks] uid inválido em removeLink'));
    if (!linkKey) return throwError(() => new Error('[UserSocialLinks] linkKey inválido em removeLink'));

    return this.requireOwner$(safeUid).pipe(
      switchMap(() => this.commitBatchRemove$(safeUid, linkKey, options.publishToPublic)),
      switchMap(() => this.patchCacheAfterRemove$(safeUid, linkKey, options)),
      tap(() => this.invalidateInFlightReads(safeUid)),
      catchError((err) => this.handleError(err, 'removeLink', options, undefined as any, true))
    );
  }

  // =============================================================================
  // READ (getDoc) com coalescência + cache
  // =============================================================================

  private getOrCreateFirestoreRead$(
    uid: string,
    options: SocialLinksOptions
  ): Observable<IUserSocialLinks | null> {
    const key = this.inFlightKey(uid, !!options.allowAnonymousRead, 'read');
    const existing = this.inFlightReads.get(key);
    if (existing) return existing;

    const read$ = this.firestoreCtx.deferPromise$(async () => {
      const ref = doc(this.db, `users/${uid}/profileData/socialLinks`);
      return getDoc(ref);
    }).pipe(
      map((snap) => (snap.exists() ? (snap.data() as IUserSocialLinks) : null)),
      tap((links) => this.setCache(uid, links, options)),
      catchError((err) => this.handleError(err, 'getDoc(socialLinks)', options, null)),
      finalize(() => this.inFlightReads.delete(key)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.inFlightReads.set(key, read$);
    return read$;
  }

  // =============================================================================
  // WATCH (docSnapshots) com coalescência + cache
  // =============================================================================

  private getOrCreateFirestoreWatch$(
    uid: string,
    options: SocialLinksOptions
  ): Observable<IUserSocialLinks | null> {
    const key = this.inFlightKey(uid, !!options.allowAnonymousRead, 'watch');
    const existing = this.inFlightWatches.get(key);
    if (existing) return existing;

    const watch$ = this.firestoreCtx.deferObservable$(() => {
      // IMPORTANT: criação do ref e do Observable dentro do Injection Context
      const ref = doc(this.db, `users/${uid}/profileData/socialLinks`);
      return docSnapshots(ref);
    }).pipe(
      map((snap) => (snap.exists() ? (snap.data() as IUserSocialLinks) : null)),
      tap((links) => this.setCache(uid, links, options)),
      catchError((err) => this.handleError(err, 'docSnapshots(socialLinks)', options, null)),
      finalize(() => this.inFlightWatches.delete(key)),
      // Compartilha 1 listener por UID entre múltiplos subscribers
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.inFlightWatches.set(key, watch$);
    return watch$;
  }

  // =============================================================================
  // FIRESTORE COMMITS (batch) - Observable-first + Injection Context
  // =============================================================================

  private commitBatchSave$(
    uid: string,
    links: IUserSocialLinks,
    publishToPublic?: boolean
  ): Observable<void> {
    return this.firestoreCtx.deferPromise$(async () => {
      const batch = writeBatch(this.db);

      // privado (fonte de verdade)
      const privateRef = doc(this.db, `users/${uid}/profileData/socialLinks`);
      batch.set(privateRef, links, { merge: true });

      // espelho público (somente subset permitido)
      if (publishToPublic === true) {
        const publicRef = doc(this.db, `public_social_links/${uid}`);
        batch.set(
          publicRef,
          { uid, ...this.toPublicPayload(links), updatedAt: serverTimestamp() },
          { merge: true }
        );
      }

      if (publishToPublic === false) {
        const publicRef = doc(this.db, `public_social_links/${uid}`);
        batch.delete(publicRef);
      }

      await batch.commit();
    }).pipe(map(() => void 0));
  }

  private commitBatchRemove$(
    uid: string,
    linkKey: keyof IUserSocialLinks,
    publishToPublic?: boolean
  ): Observable<void> {
    return this.firestoreCtx.deferPromise$(async () => {
      const batch = writeBatch(this.db);

      // privado
      const privateRef = doc(this.db, `users/${uid}/profileData/socialLinks`);
      batch.set(privateRef, { [linkKey]: deleteField() } as any, { merge: true });

      // público: não crie doc público vazio só porque removeu uma key
      if (publishToPublic === true) {
        const publicRef = doc(this.db, `public_social_links/${uid}`);
        const pubSnap = await getDoc(publicRef);
        if (pubSnap.exists()) {
          batch.set(
            publicRef,
            { [linkKey]: deleteField(), updatedAt: serverTimestamp() } as any,
            { merge: true }
          );
        }
      }

      if (publishToPublic === false) {
        const publicRef = doc(this.db, `public_social_links/${uid}`);
        batch.delete(publicRef);
      }

      await batch.commit();
    }).pipe(map(() => void 0));
  }

  // =============================================================================
  // CACHE (SWR / suporte para watch)
  // =============================================================================

  private cacheKey(uid: string): string {
    return `socialLinks:${uid}`;
  }

  private cacheMetaKey(uid: string): string {
    return `socialLinks:${uid}:meta`;
  }

  private getCacheState$(
    uid: string,
    options: SocialLinksOptions
  ): Observable<CacheState<IUserSocialLinks | null>> {
    const key = this.cacheKey(uid);
    const metaKey = this.cacheMetaKey(uid);

    return combineLatest([
      this.cache.get<IUserSocialLinks | null>(key).pipe(take(1)),
      this.cache.get<CacheMeta>(metaKey).pipe(take(1)),
    ]).pipe(
      map(([payload, meta]) => {
        if (payload === undefined) return { kind: 'miss' } as const;

        const fresh = this.isCacheFresh(meta?.cachedAt);

        // payload pode ser null (doc não existe) — ainda é um valor cacheável.
        if (fresh) return { kind: 'fresh', value: payload ?? null } as const;
        return { kind: 'stale', value: payload ?? null } as const;
      })
    );
  }

  private setCache(uid: string, links: IUserSocialLinks | null, options: SocialLinksOptions): void {
    const persist = options.persistCache === true;

    // Por padrão: NÃO persistir dados pessoais em IndexedDB
    this.cache.set(this.cacheKey(uid), links, undefined, { persist });
    this.cache.set(this.cacheMetaKey(uid), { cachedAt: Date.now() } as CacheMeta, undefined, { persist });
  }

  private patchCacheAfterRemove$(
    uid: string,
    linkKey: keyof IUserSocialLinks,
    options: SocialLinksOptions
  ): Observable<void> {
    const key = this.cacheKey(uid);

    return this.cache.get<IUserSocialLinks | null>(key).pipe(
      take(1),
      tap((cached) => {
        if (!cached) {
          this.cache.delete(this.cacheKey(uid));
          this.cache.delete(this.cacheMetaKey(uid));
          return;
        }

        const clone: any = { ...cached };
        delete clone[linkKey];
        this.setCache(uid, clone as IUserSocialLinks, options);
      }),
      map(() => void 0)
    );
  }

  private isCacheFresh(cachedAt: unknown): boolean {
    if (typeof cachedAt !== 'number' || !Number.isFinite(cachedAt)) return false;
    return Date.now() - cachedAt <= this.cacheTtlMs;
  }

  // =============================================================================
  // PUBLIC MIRROR PAYLOAD
  // =============================================================================

  /** Garante que o payload público não vaze chaves não permitidas nas rules */
  private toPublicPayload(links: IUserSocialLinks): Partial<IUserSocialLinks> {
    const allowed = [
      'facebook', 'instagram', 'twitter', 'linkedin', 'youtube', 'tiktok', 'snapchat',
      'sexlog', 'd4swing', 'buppe'
    ] as const;

    const out: any = {};
    for (const k of allowed) {
      const v = (links as any)?.[k];
      if (typeof v === 'string' || v == null) out[k] = v;
    }
    return out;
  }

  // =============================================================================
  // GATES (AUTH / OWNER)
  // =============================================================================

  private requireAuth$(): Observable<boolean> {
    return this.session.ready$.pipe(
      filter(Boolean),
      take(1),
      switchMap(() => this.session.authUser$.pipe(take(1))),
      switchMap((u: User | null) => {
        if (!u?.uid) return throwError(() => this.makeError('auth/required', 'Usuário não autenticado.'));
        return of(true);
      })
    );
  }

  private requireOwner$(targetUid: string): Observable<string> {
    return this.session.ready$.pipe(
      filter(Boolean),
      take(1),
      switchMap(() => this.session.authUser$.pipe(take(1))),
      switchMap((u: User | null) => {
        const authUid = u?.uid ?? null;
        if (!authUid) return throwError(() => this.makeError('auth/required', 'Usuário não autenticado.'));
        if (authUid !== targetUid) return throwError(() => this.makeError('auth/forbidden', 'Sem permissão.'));
        return of(authUid);
      })
    );
  }

  // =============================================================================
  // HELPERS (in-flight / deepEqual)
  // =============================================================================

  private inFlightKey(uid: string, allowAnon: boolean, kind: 'read' | 'watch'): string {
    return `${kind}::${uid}::${allowAnon ? 'anon' : 'auth'}`;
  }

  private invalidateInFlightReads(uid: string): void {
    this.inFlightReads.delete(this.inFlightKey(uid, true, 'read'));
    this.inFlightReads.delete(this.inFlightKey(uid, false, 'read'));
  }

  private deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }

  // =============================================================================
  // ERROS (centralizados)
  // =============================================================================

  private handleError<T>(
    err: unknown,
    context: string,
    options: SocialLinksOptions,
    fallback: T,
    rethrow = false,
  ): Observable<T> {
    const wrapped = this.wrapError(err, context);

    try { this.globalError.handleError(wrapped); } catch { }

    if (options.notifyOnError) {
      const now = Date.now();
      if (now - this.lastNotifyAt > 12_000) {
        this.lastNotifyAt = now;
        this.notifier.showError('Falha ao processar redes sociais.');
      }
    }

    if (rethrow) return throwError(() => wrapped);
    return of(fallback);
  }

  private wrapError(err: unknown, context: string): Error {
    const e = err instanceof Error ? err : new Error(String(err ?? 'unknown error'));
    (e as any).silent = true;
    (e as any).feature = 'user-social-links';
    (e as any).context = context;
    (e as any).original = err;
    return e;
  }

  private makeError(code: string, message: string): Error {
    const e = new Error(message);
    (e as any).code = code;
    (e as any).silent = true;
    (e as any).feature = 'user-social-links';
    return e;
  }
}
