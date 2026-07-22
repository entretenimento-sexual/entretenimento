// src/app/core/services/user-profile/user-social-links.service.ts
// =============================================================================
// USER SOCIAL LINKS SERVICE
//
// Responsabilidade:
// - manter a fonte privada em /users/{uid}/profileData/socialLinks;
// - manter o espelho público em /public_social_links/{uid};
// - adicionar/alterar/publicar somente com assinatura ativa;
// - preservar remoção pelo dono mesmo após o término da assinatura;
// - separar contexto privado e público;
// - nunca reutilizar cache público sem revalidar as Firestore Rules;
// - tratar redes públicas indisponíveis por política como ausência normal.
// =============================================================================

import { Injectable } from '@angular/core';
import {
  Firestore,
  deleteField,
  doc,
  docSnapshots,
  getDoc,
  serverTimestamp,
  writeBatch,
} from '@angular/fire/firestore';
import type { User } from 'firebase/auth';
import {
  Observable,
  combineLatest,
  concat,
  of,
  throwError,
} from 'rxjs';
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
import { ErrorNotificationService } from '../error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { CacheService } from '../general/cache/cache.service';

export type SocialLinksOptions = {
  notifyOnError?: boolean;
  publishToPublic?: boolean;
  allowAnonymousRead?: boolean;
  persistCache?: boolean;
};

type SocialLinksReadScope = 'private' | 'public';

type SocialLinksReadContext = {
  readonly uid: string;
  readonly scope: SocialLinksReadScope;
  readonly path: string;
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

  getSocialLinks(
    uid: string,
    options: SocialLinksOptions = {}
  ): Observable<IUserSocialLinks | null> {
    const safeUid = String(uid ?? '').trim();
    if (!safeUid) return of(null);

    return this.resolveReadContext$(safeUid, options).pipe(
      switchMap((context) =>
        this.getCacheState$(context.uid, context.scope, options).pipe(
          map((state) => ({ context, state }))
        )
      ),
      switchMap(({ context, state }) => {
        if (state.kind === 'fresh') return of(state.value);

        if (state.kind === 'stale') {
          const cached$ = of(state.value);
          const refresh$ = this.getOrCreateFirestoreRead$(
            context,
            options
          ).pipe(catchError(() => of(state.value)));

          return concat(cached$, refresh$).pipe(
            distinctUntilChanged((a, b) => this.deepEqual(a, b))
          );
        }

        return this.getOrCreateFirestoreRead$(context, options);
      }),
      catchError((error) =>
        this.handleError(error, 'getSocialLinks', options, null)
      )
    );
  }

  watchSocialLinks(
    uid: string,
    options: SocialLinksOptions = {}
  ): Observable<IUserSocialLinks | null> {
    const safeUid = String(uid ?? '').trim();
    if (!safeUid) return of(null);

    return this.resolveReadContext$(safeUid, options).pipe(
      switchMap((context) =>
        this.getOrCreateFirestoreWatch$(context, options)
      ),
      catchError((error) =>
        this.handleError(error, 'watchSocialLinks', options, null)
      )
    );
  }

  saveSocialLinks(
    uid: string,
    links: IUserSocialLinks,
    options: SocialLinksOptions = {}
  ): Observable<void> {
    const safeUid = String(uid ?? '').trim();
    if (!safeUid) {
      return throwError(() =>
        this.makeError(
          'social-links/invalid-uid',
          'UID inválido para publicar redes sociais.'
        )
      );
    }

    const safeLinks = this.toSupportedPayload(links ?? {});
    const publishToPublic = options.publishToPublic ?? true;

    return this.requireOwner$(safeUid).pipe(
      switchMap(() => this.requireActiveSubscriber$()),
      switchMap(() =>
        this.commitBatchSave$(safeUid, safeLinks, publishToPublic)
      ),
      tap(() => {
        this.invalidateCaches(safeUid);
        this.invalidateInFlight(safeUid);
        this.setCache(safeUid, 'private', safeLinks, options);
      }),
      catchError((error) =>
        this.handleError(
          error,
          'saveSocialLinks',
          options,
          undefined as void,
          true
        )
      )
    );
  }

  removeLink(
    uid: string,
    linkKey: keyof IUserSocialLinks,
    options: SocialLinksOptions = {}
  ): Observable<void> {
    const safeUid = String(uid ?? '').trim();
    const safeKey = String(linkKey ?? '').trim();

    if (!safeUid) {
      return throwError(() =>
        this.makeError(
          'social-links/invalid-uid',
          'UID inválido para remover rede social.'
        )
      );
    }

    if (!this.isSupportedLinkKey(safeKey)) {
      return throwError(() =>
        this.makeError(
          'social-links/invalid-key',
          'Rede social inválida para remoção.'
        )
      );
    }

    const publishToPublic = options.publishToPublic ?? true;

    return this.requireOwner$(safeUid).pipe(
      switchMap(() =>
        this.commitBatchRemove$(safeUid, safeKey, publishToPublic)
      ),
      tap(() => {
        this.invalidateCaches(safeUid);
        this.invalidateInFlight(safeUid);
      }),
      catchError((error) =>
        this.handleError(
          error,
          'removeLink',
          options,
          undefined as void,
          true
        )
      )
    );
  }

  private resolveReadContext$(
    uid: string,
    options: SocialLinksOptions
  ): Observable<SocialLinksReadContext> {
    const authUid$ = options.allowAnonymousRead
      ? this.session.authUser$.pipe(
          take(1),
          map((user) => user?.uid ?? null)
        )
      : this.requireAuthUid$();

    return authUid$.pipe(
      map((authUid) => {
        const scope: SocialLinksReadScope =
          authUid === uid ? 'private' : 'public';

        return {
          uid,
          scope,
          path:
            scope === 'private'
              ? `users/${uid}/profileData/socialLinks`
              : `public_social_links/${uid}`,
        };
      })
    );
  }

  private getOrCreateFirestoreRead$(
    context: SocialLinksReadContext,
    options: SocialLinksOptions
  ): Observable<IUserSocialLinks | null> {
    const key = this.inFlightKey(context, 'read');
    const existing = this.inFlightReads.get(key);
    if (existing) return existing;

    const read$ = this.firestoreCtx
      .deferPromise$(async () => getDoc(doc(this.db, context.path)))
      .pipe(
        map((snapshot) =>
          snapshot.exists()
            ? this.toSupportedPayload(
                snapshot.data() as IUserSocialLinks
              )
            : null
        ),
        tap((links) =>
          this.setCache(
            context.uid,
            context.scope,
            links,
            options
          )
        ),
        catchError((error) => {
          if (
            context.scope === 'public' &&
            this.isPermissionDenied(error)
          ) {
            return of(null);
          }

          return this.handleError(
            error,
            `getDoc(socialLinks:${context.scope})`,
            options,
            null
          );
        }),
        finalize(() => this.inFlightReads.delete(key)),
        shareReplay({ bufferSize: 1, refCount: true })
      );

    this.inFlightReads.set(key, read$);
    return read$;
  }

  private getOrCreateFirestoreWatch$(
    context: SocialLinksReadContext,
    options: SocialLinksOptions
  ): Observable<IUserSocialLinks | null> {
    const key = this.inFlightKey(context, 'watch');
    const existing = this.inFlightWatches.get(key);
    if (existing) return existing;

    const watch$ = this.firestoreCtx
      .deferObservable$(() =>
        docSnapshots(doc(this.db, context.path))
      )
      .pipe(
        map((snapshot) =>
          snapshot.exists()
            ? this.toSupportedPayload(
                snapshot.data() as IUserSocialLinks
              )
            : null
        ),
        tap((links) =>
          this.setCache(
            context.uid,
            context.scope,
            links,
            options
          )
        ),
        catchError((error) => {
          if (
            context.scope === 'public' &&
            this.isPermissionDenied(error)
          ) {
            return of(null);
          }

          return this.handleError(
            error,
            `docSnapshots(socialLinks:${context.scope})`,
            options,
            null
          );
        }),
        finalize(() => this.inFlightWatches.delete(key)),
        shareReplay({ bufferSize: 1, refCount: true })
      );

    this.inFlightWatches.set(key, watch$);
    return watch$;
  }

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
        const publicRef = doc(this.db, `public_social_links/${uid}`);

        batch.set(privateRef, links, { merge: false });

        if (publishToPublic && this.hasLinks(links)) {
          batch.set(
            publicRef,
            {
              uid,
              ...links,
              updatedAt: serverTimestamp(),
            },
            { merge: false }
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
    linkKey: (typeof this.publicLinkKeys)[number],
    publishToPublic: boolean
  ): Observable<void> {
    return this.firestoreCtx
      .deferPromise$(async () => {
        const batch = writeBatch(this.db);
        const privateRef = doc(
          this.db,
          `users/${uid}/profileData/socialLinks`
        );
        const publicRef = doc(this.db, `public_social_links/${uid}`);

        batch.set(
          privateRef,
          { [linkKey]: deleteField() },
          { merge: true }
        );

        if (!publishToPublic) {
          batch.delete(publicRef);
          await batch.commit();
          return;
        }

        const publicSnapshot = await getDoc(publicRef);

        if (publicSnapshot.exists()) {
          const publicData = this.toSupportedPayload(
            publicSnapshot.data() as IUserSocialLinks
          );
          const remaining = { ...publicData };
          delete remaining[linkKey];

          if (!this.hasLinks(remaining)) {
            batch.delete(publicRef);
          } else {
            batch.set(
              publicRef,
              {
                [linkKey]: deleteField(),
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
          }
        }

        await batch.commit();
      })
      .pipe(map(() => void 0));
  }

  private cacheKey(
    uid: string,
    scope: SocialLinksReadScope
  ): string {
    return `socialLinks:${scope}:${uid}`;
  }

  private cacheMetaKey(
    uid: string,
    scope: SocialLinksReadScope
  ): string {
    return `${this.cacheKey(uid, scope)}:meta`;
  }

  private getCacheState$(
    uid: string,
    scope: SocialLinksReadScope,
    options: SocialLinksOptions
  ): Observable<CacheState<IUserSocialLinks | null>> {
    if (scope === 'public') {
      return of({ kind: 'miss' } as const);
    }

    const key = this.cacheKey(uid, scope);
    const metaKey = this.cacheMetaKey(uid, scope);

    return combineLatest([
      this.cache.get<IUserSocialLinks | null>(key).pipe(take(1)),
      this.cache.get<CacheMeta>(metaKey).pipe(take(1)),
    ]).pipe(
      map(([payload, meta]) => {
        if (payload === undefined) return { kind: 'miss' } as const;

        return this.isCacheFresh(meta?.cachedAt)
          ? { kind: 'fresh', value: payload ?? null } as const
          : { kind: 'stale', value: payload ?? null } as const;
      })
    );
  }

  private setCache(
    uid: string,
    scope: SocialLinksReadScope,
    links: IUserSocialLinks | null,
    options: SocialLinksOptions
  ): void {
    if (scope === 'public') {
      this.cache.delete(this.cacheKey(uid, scope));
      this.cache.delete(this.cacheMetaKey(uid, scope));
      return;
    }

    const persist = options.persistCache === true;

    this.cache.set(
      this.cacheKey(uid, scope),
      links,
      undefined,
      { persist }
    );
    this.cache.set(
      this.cacheMetaKey(uid, scope),
      { cachedAt: Date.now() } as CacheMeta,
      undefined,
      { persist }
    );
  }

  private invalidateCaches(uid: string): void {
    (['private', 'public'] as const).forEach((scope) => {
      this.cache.delete(this.cacheKey(uid, scope));
      this.cache.delete(this.cacheMetaKey(uid, scope));
    });

    this.cache.delete(`socialLinks:${uid}`);
    this.cache.delete(`socialLinks:${uid}:meta`);
  }

  private isCacheFresh(cachedAt: unknown): boolean {
    return (
      typeof cachedAt === 'number' &&
      Number.isFinite(cachedAt) &&
      Date.now() - cachedAt <= this.cacheTtlMs
    );
  }

  private toSupportedPayload(
    links: IUserSocialLinks
  ): IUserSocialLinks {
    const output: IUserSocialLinks = {};

    for (const key of this.publicLinkKeys) {
      const value = String(links[key] ?? '').trim();
      if (value) output[key] = value;
    }

    return output;
  }

  private hasLinks(links: IUserSocialLinks): boolean {
    return this.publicLinkKeys.some((key) =>
      String(links[key] ?? '').trim().length > 0
    );
  }

  private isSupportedLinkKey(
    value: string
  ): value is (typeof this.publicLinkKeys)[number] {
    return (this.publicLinkKeys as readonly string[]).includes(value);
  }

  private requireAuthUid$(): Observable<string> {
    return this.session.ready$.pipe(
      filter(Boolean),
      take(1),
      switchMap(() => this.session.authUser$.pipe(take(1))),
      switchMap((user: User | null) => {
        const authUid = String(user?.uid ?? '').trim();

        return authUid
          ? of(authUid)
          : throwError(() =>
              this.makeError(
                'auth/required',
                'Usuário não autenticado.'
              )
            );
      })
    );
  }

  private requireOwner$(targetUid: string): Observable<string> {
    return this.requireAuthUid$().pipe(
      switchMap((authUid) =>
        authUid === targetUid
          ? of(authUid)
          : throwError(() =>
              this.makeError('auth/forbidden', 'Sem permissão.')
            )
      )
    );
  }

  private requireActiveSubscriber$(): Observable<boolean> {
    return combineLatest([
      this.accessControl.appUserResolved$,
      this.accessControl.isSubscriber$,
    ]).pipe(
      filter(([resolved]) => resolved === true),
      take(1),
      switchMap(([, isSubscriber]) =>
        isSubscriber
          ? of(true)
          : throwError(() =>
              this.makeError(
                'subscription/required',
                'Assinatura ativa necessária para publicar redes sociais.'
              )
            )
      )
    );
  }

  private inFlightKey(
    context: SocialLinksReadContext,
    kind: 'read' | 'watch'
  ): string {
    return `${kind}::${context.scope}::${context.uid}`;
  }

  private invalidateInFlight(uid: string): void {
    for (const key of this.inFlightReads.keys()) {
      if (key.endsWith(`::${uid}`)) this.inFlightReads.delete(key);
    }

    for (const key of this.inFlightWatches.keys()) {
      if (key.endsWith(`::${uid}`)) this.inFlightWatches.delete(key);
    }
  }

  private isPermissionDenied(error: unknown): boolean {
    const code = String((error as { code?: unknown } | null)?.code ?? '')
      .trim()
      .toLowerCase();

    return (
      code === 'permission-denied' ||
      code === 'firestore/permission-denied' ||
      code.endsWith('/permission-denied')
    );
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
    error: unknown,
    context: string,
    options: SocialLinksOptions,
    fallback: T,
    rethrow = false
  ): Observable<T> {
    const wrapped = this.wrapError(error, context);

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

    return rethrow ? throwError(() => wrapped) : of(fallback);
  }

  private wrapError(error: unknown, context: string): Error {
    const normalized =
      error instanceof Error
        ? error
        : new Error(String(error ?? 'unknown error'));

    (normalized as any).silent = true;
    (normalized as any).feature = 'user-social-links';
    (normalized as any).context = context;
    (normalized as any).original = error;
    (normalized as any).skipUserNotification = true;
    return normalized;
  }

  private makeError(code: string, message: string): Error {
    const error = new Error(message);
    (error as any).code = code;
    (error as any).silent = true;
    (error as any).feature = 'user-social-links';
    (error as any).skipUserNotification = true;
    return error;
  }
}
