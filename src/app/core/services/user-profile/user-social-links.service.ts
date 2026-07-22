// src/app/core/services/user-profile/user-social-links.service.ts
// =============================================================================
// USER SOCIAL LINKS SERVICE
//
// Responsabilidade:
// - Ler, observar em tempo real, salvar e remover links sociais do perfil.
// - Manter a fonte privada em /users/{uid}/profileData/socialLinks.
// - Manter o espelho público em /public_social_links/{uid}.
//
// Contrato de assinatura:
// - adicionar/alterar/publicar exige assinatura ativa;
// - remover continua permitido ao dono para preservar privacidade;
// - visitantes autenticados leem somente o espelho autorizado pelas Rules.
//
// Padrões:
// - Observable-first;
// - injection context garantido por FirestoreContextService;
// - coalescência de leituras/listeners;
// - cache em memória por padrão;
// - erros roteados para GlobalErrorHandlerService.
// =============================================================================

import { Injectable } from '@angular/core';
import {
  doc,
  getDoc,
  writeBatch,
  deleteField,
  serverTimestamp,
  docSnapshots,
  Firestore,
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
import { AccessControlService } from '../autentication/auth/access-control.service';
import { AuthSessionService } from '../autentication/auth/auth-session.service';
import { FirestoreContextService } from '../data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';
import { CacheService } from '../general/cache/cache.service';

export type SocialLinksOptions = {
  notifyOnError?: boolean;

  /**
   * true  -> upsert /public_social_links/{uid}
   * false -> delete /public_social_links/{uid}
   * undefined -> publica por padrão em save/remove
   */
  publishToPublic?: boolean;

  /**
   * Leitura/watch sem auth só se as Rules permitirem.
   * Se false/undefined, o service não inicia getDoc/docSnapshots sem auth.
   */
  allowAnonymousRead?: boolean;

  /** Cache persistente é opt-in para evitar dados pessoais em device compartilhado. */
  persistCache?: boolean;
};

type CacheMeta = { cachedAt: number };
type CacheState<T> =
  | { kind: 'miss' }
  | { kind: 'fresh'; value: T }
  | { kind: 'stale'; value: T };

@Injectable({ providedIn: 'root' })
export class UserSocialLinksService {
  private readonly cacheTtlMs = 10 * 60 * 1000;
  private lastNotifyAt = 0;

  private readonly inFlightReads = new Map<
    string,
    Observable<IUserSocialLinks | null>
  >();

  private readonly inFlightWatches = new Map<
    string,
    Observable<IUserSocialLinks | null>
  >();

  private readonly publicLinkKeys = [
    'facebook',
    'instagram',
    'twitter',
    'linkedin',
    'youtube',
    'tiktok',
    'snapchat',
    'sexlog',
    'd4swing',
    'hotvips',
    'privacy',
    'onlyfans',
    'fansly',
    'linktree',
  ] as const;

  constructor(
    private readonly db: Firestore,
    private readonly firestoreCtx: FirestoreContextService,
    private readonly cache: CacheService,
    private readonly session: AuthSessionService,
    private readonly accessControl: AccessControlService,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly notifier: ErrorNotificationService
  ) {}

  private isOwnerTarget(
    targetUid: string,
    authUid: string | null | undefined
  ): boolean {
    return !!authUid && authUid === targetUid;
  }

  private privateSocialLinksPath(uid: string): string {
    return `users/${uid}/profileData/socialLinks`;
  }

  private publicSocialLinksPath(uid: string): string {
    return `public_social_links/${uid}`;
  }

  private resolveReadPath(
    targetUid: string,
    authUid: string | null | undefined
  ): string {
    return this.isOwnerTarget(targetUid, authUid)
      ? this.privateSocialLinksPath(targetUid)
      : this.publicSocialLinksPath(targetUid);
  }

  // =============================================================================
  // API PÚBLICA
  // =============================================================================

  getSocialLinks(
    uid: string,
    options: SocialLinksOptions = {}
  ): Observable<IUserSocialLinks | null> {
    const safeUid = (uid ?? '').trim();
    if (!safeUid) return of(null);

    const gate$ = options.allowAnonymousRead ? of(true) : this.requireAuth$();

    return gate$.pipe(
      switchMap(() => this.getCacheState$(safeUid, options)),
      switchMap((state) => {
        if (state.kind === 'fresh') return of(state.value);

        if (state.kind === 'stale') {
          const cached$ = of(state.value);
          const refresh$ = this.getOrCreateFirestoreRead$(
            safeUid,
            options
          ).pipe(catchError(() => of(state.value)));

          return concat(cached$, refresh$).pipe(
            distinctUntilChanged((a, b) => this.deepEqual(a, b))
          );
        }

        return this.getOrCreateFirestoreRead$(safeUid, options);
      }),
      catchError((err) =>
        this.handleError(err, 'getSocialLinks', options, null)
      )
    );
  }

  watchSocialLinks(
    uid: string,
    options: SocialLinksOptions = {}
  ): Observable<IUserSocialLinks | null> {
    const safeUid = (uid ?? '').trim();
    if (!safeUid) return of(null);

    if (options.allowAnonymousRead) {
      return this.getOrCreateFirestoreWatch$(safeUid, options).pipe(
        catchError((err) =>
          this.handleError(err, 'watchSocialLinks', options, null)
        )
      );
    }

    return this.session.ready$.pipe(
      switchMap((ready) => (ready ? this.session.authUser$ : of(null))),
      map((user) => user?.uid ?? null),
      distinctUntilChanged(),
      switchMap((authUid) => {
        if (!authUid) return of(null);
        return this.getOrCreateFirestoreWatch$(safeUid, options);
      }),
      catchError((err) =>
        this.handleError(err, 'watchSocialLinks', options, null)
      )
    );
  }

  /**
   * Adicionar/alterar exige dono e assinatura ativa.
   * O espelho público é atualizado por padrão.
   */
  saveSocialLinks(
    uid: string,
    links: IUserSocialLinks,
    options: SocialLinksOptions = {}
  ): Observable<void> {
    const safeUid = (uid ?? '').trim();
    if (!safeUid) {
      return throwError(
        () => new Error('[UserSocialLinks] uid inválido em saveSocialLinks')
      );
    }

    const safeLinks = (links ?? {}) as IUserSocialLinks;
    const publishToPublic = options.publishToPublic ?? true;

    return this.requireOwner$(safeUid).pipe(
      switchMap(() => this.requireActiveSubscriber$()),
      switchMap(() =>
        this.commitBatchSave$(safeUid, safeLinks, publishToPublic)
      ),
      tap(() => {
        this.setCache(safeUid, safeLinks, options);
        this.invalidateInFlightReads(safeUid);
      }),
      catchError((err) =>
        this.handleError(
          err,
          'saveSocialLinks',
          options,
          undefined as any,
          true
        )
      )
    );
  }

  /**
   * Remoção exige apenas o dono. Isso permite limpar dados mesmo após o término
   * da assinatura. O espelho público é sincronizado por padrão.
   */
  removeLink(
    uid: string,
    linkKey: keyof IUserSocialLinks,
    options: SocialLinksOptions = {}
  ): Observable<void> {
    const safeUid = (uid ?? '').trim();
    if (!safeUid) {
      return throwError(
        () => new Error('[UserSocialLinks] uid inválido em removeLink')
      );
    }
    if (!linkKey) {
      return throwError(
        () => new Error('[UserSocialLinks] linkKey inválido em removeLink')
      );
    }

    const publishToPublic = options.publishToPublic ?? true;

    return this.requireOwner$(safeUid).pipe(
      switchMap(() =>
        this.commitBatchRemove$(safeUid, linkKey, publishToPublic)
      ),
      switchMap(() =>
        this.patchCacheAfterRemove$(safeUid, linkKey, options)
      ),
      tap(() => this.invalidateInFlightReads(safeUid)),
      catchError((err) =>
        this.handleError(
          err,
          'removeLink',
          options,
          undefined as any,
          true
        )
      )
    );
  }

  // =============================================================================
  // READ / WATCH
  // =============================================================================

  private getOrCreateFirestoreRead$(
    uid: string,
    options: SocialLinksOptions
  ): Observable<IUserSocialLinks | null> {
    return this.session.authUser$.pipe(
      take(1),
      switchMap((authUser) => {
        const authUid = authUser?.uid ?? null;
        const scope = this.isOwnerTarget(uid, authUid) ? 'private' : 'public';
        const path = this.resolveReadPath(uid, authUid);
        const key = this.inFlightKey(
          `${uid}:${scope}`,
          !!options.allowAnonymousRead,
          'read'
        );
        const existing = this.inFlightReads.get(key);
        if (existing) return existing;

        const read$ = this.firestoreCtx
          .deferPromise$(async () => {
            const ref = doc(this.db, path);
            return getDoc(ref);
          })
          .pipe(
            map((snap) =>
              snap.exists() ? (snap.data() as IUserSocialLinks) : null
            ),
            tap((links) => this.setCache(uid, links, options)),
            catchError((err) =>
              this.handleError(
                err,
                `getDoc(socialLinks:${scope})`,
                options,
                null
              )
            ),
            finalize(() => this.inFlightReads.delete(key)),
            shareReplay({ bufferSize: 1, refCount: true })
          );

        this.inFlightReads.set(key, read$);
        return read$;
      })
    );
  }

  private getOrCreateFirestoreWatch$(
    uid: string,
    options: SocialLinksOptions
  ): Observable<IUserSocialLinks | null> {
    return this.session.authUser$.pipe(
      take(1),
      switchMap((authUser) => {
        const authUid = authUser?.uid ?? null;
        const scope = this.isOwnerTarget(uid, authUid) ? 'private' : 'public';
        const path = this.resolveReadPath(uid, authUid);
        const key = this.inFlightKey(
          `${uid}:${scope}`,
          !!options.allowAnonymousRead,
          'watch'
        );
        const existing = this.inFlightWatches.get(key);
        if (existing) return existing;

        const watch$ = this.firestoreCtx
          .deferObservable$(() => {
            const ref = doc(this.db, path);
            return docSnapshots(ref);
          })
          .pipe(
            map((snap) =>
              snap.exists() ? (snap.data() as IUserSocialLinks) : null
            ),
            tap((links) => this.setCache(uid, links, options)),
            catchError((err) =>
              this.handleError(
                err,
                `docSnapshots(socialLinks:${scope})`,
                options,
                null
              )
            ),
            finalize(() => this.inFlightWatches.delete(key)),
            shareReplay({ bufferSize: 1, refCount: true })
          );

        this.inFlightWatches.set(key, watch$);
        return watch$;
      })
    );
  }

  // =============================================================================
  // FIRESTORE COMMITS
  // =============================================================================

  private commitBatchSave$(
    uid: string,
    links: IUserSocialLinks,
    publishToPublic: boolean
  ): Observable<void> {
    return this.firestoreCtx
      .deferPromise$(async () => {
        const batch = writeBatch(this.db);
        const privateRef = doc(
          this.db,
          `users/${uid}/profileData/socialLinks`
        );

        batch.set(privateRef, links, { merge: true });

        const publicRef = doc(this.db, `public_social_links/${uid}`);
        if (publishToPublic) {
          batch.set(
            publicRef,
            {
              uid,
              ...this.toPublicPayload(links),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        } else {
          batch.delete(publicRef);
        }

        await batch.commit();
      })
      .pipe(map(() => void 0));
  }

  private commitBatchRemove$(
    uid: string,
    linkKey: keyof IUserSocialLinks,
    publishToPublic: boolean
  ): Observable<void> {
    return this.firestoreCtx
      .deferPromise$(async () => {
        const batch = writeBatch(this.db);
        const privateRef = doc(
          this.db,
          `users/${uid}/profileData/socialLinks`
        );

        batch.set(
          privateRef,
          { [linkKey]: deleteField() } as any,
          { merge: true }
        );

        const publicRef = doc(this.db, `public_social_links/${uid}`);

        if (!publishToPublic) {
          batch.delete(publicRef);
          await batch.commit();
          return;
        }

        const publicSnap = await getDoc(publicRef);
        if (publicSnap.exists()) {
          const publicData = publicSnap.data() as Record<string, unknown>;
          const remainingLinks = this.publicLinkKeys.filter((key) => {
            if (key === linkKey) return false;
            const value = publicData[key];
            return typeof value === 'string' && value.trim().length > 0;
          });

          if (remainingLinks.length === 0) {
            batch.delete(publicRef);
          } else {
            batch.set(
              publicRef,
              {
                [linkKey]: deleteField(),
                updatedAt: serverTimestamp(),
              } as any,
              { merge: true }
            );
          }
        }

        await batch.commit();
      })
      .pipe(map(() => void 0));
  }

  // =============================================================================
  // CACHE
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
        if (fresh) {
          return { kind: 'fresh', value: payload ?? null } as const;
        }
        return { kind: 'stale', value: payload ?? null } as const;
      })
    );
  }

  private setCache(
    uid: string,
    links: IUserSocialLinks | null,
    options: SocialLinksOptions
  ): void {
    const persist = options.persistCache === true;

    this.cache.set(this.cacheKey(uid), links, undefined, { persist });
    this.cache.set(
      this.cacheMetaKey(uid),
      { cachedAt: Date.now() } as CacheMeta,
      undefined,
      { persist }
    );
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

        const clone: IUserSocialLinks = { ...cached };
        delete clone[linkKey];
        this.setCache(uid, clone, options);
      }),
      map(() => void 0)
    );
  }

  private isCacheFresh(cachedAt: unknown): boolean {
    if (typeof cachedAt !== 'number' || !Number.isFinite(cachedAt)) {
      return false;
    }
    return Date.now() - cachedAt <= this.cacheTtlMs;
  }

  // =============================================================================
  // PUBLIC MIRROR PAYLOAD
  // =============================================================================

  private toPublicPayload(
    links: IUserSocialLinks
  ): Partial<IUserSocialLinks> {
    const out: Partial<IUserSocialLinks> = {};

    for (const key of this.publicLinkKeys) {
      const value = links[key];
      if (typeof value === 'string' || value == null) {
        out[key] = value ?? undefined;
      }
    }

    return out;
  }

  // =============================================================================
  // GATES
  // =============================================================================

  private requireAuth$(): Observable<boolean> {
    return this.session.ready$.pipe(
      filter(Boolean),
      take(1),
      switchMap(() => this.session.authUser$.pipe(take(1))),
      switchMap((user: User | null) => {
        if (!user?.uid) {
          return throwError(() =>
            this.makeError('auth/required', 'Usuário não autenticado.')
          );
        }
        return of(true);
      })
    );
  }

  private requireOwner$(targetUid: string): Observable<string> {
    return this.session.ready$.pipe(
      filter(Boolean),
      take(1),
      switchMap(() => this.session.authUser$.pipe(take(1))),
      switchMap((user: User | null) => {
        const authUid = user?.uid ?? null;
        if (!authUid) {
          return throwError(() =>
            this.makeError('auth/required', 'Usuário não autenticado.')
          );
        }
        if (authUid !== targetUid) {
          return throwError(() =>
            this.makeError('auth/forbidden', 'Sem permissão.')
          );
        }
        return of(authUid);
      })
    );
  }

  private requireActiveSubscriber$(): Observable<boolean> {
    return combineLatest([
      this.accessControl.appUserResolved$,
      this.accessControl.isSubscriber$,
    ]).pipe(
      filter(([resolved]) => resolved === true),
      take(1),
      switchMap(([, isSubscriber]) => {
        if (!isSubscriber) {
          return throwError(() =>
            this.makeError(
              'subscription/required',
              'Assinatura ativa necessária para publicar redes sociais.'
            )
          );
        }
        return of(true);
      })
    );
  }

  // =============================================================================
  // HELPERS / ERROS
  // =============================================================================

  private inFlightKey(
    uid: string,
    allowAnon: boolean,
    kind: 'read' | 'watch'
  ): string {
    return `${kind}::${uid}::${allowAnon ? 'anon' : 'auth'}`;
  }

  private invalidateInFlightReads(uid: string): void {
    this.inFlightReads.delete(this.inFlightKey(uid, true, 'read'));
    this.inFlightReads.delete(this.inFlightKey(uid, false, 'read'));
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }

  private handleError<T>(
    err: unknown,
    context: string,
    options: SocialLinksOptions,
    fallback: T,
    rethrow = false
  ): Observable<T> {
    const wrapped = this.wrapError(err, context);

    try {
      this.globalError.handleError(wrapped);
    } catch {
      // noop
    }

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
    const error =
      err instanceof Error
        ? err
        : new Error(String(err ?? 'unknown error'));

    (error as any).silent = true;
    (error as any).feature = 'user-social-links';
    (error as any).context = context;
    (error as any).original = err;
    return error;
  }

  private makeError(code: string, message: string): Error {
    const error = new Error(message);
    (error as any).code = code;
    (error as any).silent = true;
    (error as any).feature = 'user-social-links';
    return error;
  }
}
