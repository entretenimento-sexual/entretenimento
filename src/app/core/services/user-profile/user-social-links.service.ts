// src/app/core/services/user-profile/user-social-links.service.ts
// =============================================================================
// USER SOCIAL LINKS SERVICE
//
// Responsabilidade:
// - ler, observar, salvar e remover links sociais do perfil;
// - manter opcionalmente o espelho público em /public_social_links/{uid};
// - separar rigorosamente cache privado do dono e cache do espelho público.
//
// Arquitetura:
// - APIs públicas Observable-first;
// - Firestore/Functions continuam como fonte de verdade;
// - leituras e listeners concorrentes são coalescidos;
// - cache tipado por contexto de leitura, viewer e sensibilidade;
// - nenhum link social é persistido no navegador.
//
// SUPRESSÕES EXPLÍCITAS DESTA MIGRAÇÃO:
// - SUPRIMIDAS as chaves `socialLinks:{uid}` e `socialLinks:{uid}:meta`.
//   Motivo: não distinguiam documento privado do dono e espelho público.
// - SUPRIMIDO o cálculo manual de TTL por metadado separado.
//   Motivo: TTL e stale window pertencem ao envelope do AppCacheService.
// - SUPRIMIDO o efeito de `persistCache: true`.
//   Motivo: links pessoais não devem permanecer no IndexedDB de dispositivo
//   compartilhado. A propriedade foi mantida somente por compatibilidade de API.
// - SUPRIMIDO o CacheService legado neste serviço.
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
import type { WithFieldValue } from 'firebase/firestore';
import { Observable, concat, filter, finalize, forkJoin, map, of, shareReplay, switchMap, take, throwError } from 'rxjs';
import { catchError, distinctUntilChanged } from 'rxjs/operators';

import { IUserSocialLinks } from '../../interfaces/interfaces-user-dados/iuser-social-links';
import { AuthSessionService } from '../autentication/auth/auth-session.service';
import { FirestoreContextService } from '../data-handling/firestore/core/firestore-context.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { AppCacheService } from '../general/cache/app-cache.service';
import {
  CacheDefinition,
  CacheResult,
} from '../general/cache/cache-contracts';

export type SocialLinksOptions = {
  notifyOnError?: boolean;

  /**
   * true  -> upsert /public_social_links/{uid}
   * false -> delete /public_social_links/{uid}
   * undefined -> não altera o espelho
   */
  publishToPublic?: boolean;

  /**
   * Leitura/watch sem auth somente quando as rules permitirem.
   */
  allowAnonymousRead?: boolean;

  /**
   * @deprecated Mantido por compatibilidade. Links sociais são sempre memory-only.
   */
  persistCache?: boolean;
};

type SocialLinksReadKind =
  | 'owner-private'
  | 'public-authenticated'
  | 'public-anonymous';

type SocialLinksReadContext = {
  targetUid: string;
  authUid: string | null;
  kind: SocialLinksReadKind;
  path: string;
  cacheDefinition: CacheDefinition<IUserSocialLinks | null>;
};

@Injectable({ providedIn: 'root' })
export class UserSocialLinksService {
  private static readonly CACHE_TTL_MS = 10 * 60_000;
  private static readonly CACHE_STALE_MS = 5 * 60_000;
  private static readonly CACHE_VERSION = 2;

  private static readonly PUBLIC_KEYS = [
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

  private lastNotifyAt = 0;

  private readonly inFlightReads = new Map<
    string,
    Observable<IUserSocialLinks | null>
  >();

  private readonly inFlightWatches = new Map<
    string,
    Observable<IUserSocialLinks | null>
  >();

  constructor(
    private readonly db: Firestore,
    private readonly firestoreCtx: FirestoreContextService,
    private readonly cache: AppCacheService,
    private readonly session: AuthSessionService,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly notifier: ErrorNotificationService
  ) {}

  // =============================================================================
  // API PÚBLICA
  // =============================================================================

  /**
   * Leitura one-shot com stale-while-revalidate.
   */
  getSocialLinks(
    uid: string,
    options: SocialLinksOptions = {}
  ): Observable<IUserSocialLinks | null> {
    const safeUid = this.normalizeUid(uid);
    if (!safeUid) return of(null);

    return this.resolveOneShotContext$(safeUid, options).pipe(
      switchMap((context) =>
        this.cache.get$(context.cacheDefinition).pipe(
          switchMap((result) => {
            if (result.status === 'fresh') {
              return of(result.value);
            }

            if (result.status === 'stale') {
              const cached$ = of(result.value);
              const refresh$ = this.getOrCreateFirestoreRead$(context).pipe(
                catchError((error) =>
                  this.handleError(
                    error,
                    `getSocialLinks.refresh:${context.kind}`,
                    options,
                    result.value
                  )
                )
              );

              return concat(cached$, refresh$).pipe(
                distinctUntilChanged((a, b) => this.deepEqual(a, b))
              );
            }

            return this.getOrCreateFirestoreRead$(context);
          })
        )
      ),
      catchError((error) =>
        this.handleError(error, 'getSocialLinks', options, null)
      )
    );
  }

  /**
   * Listener realtime. Mudanças de autenticação cancelam o listener anterior e
   * recalculam caminho e definição de cache.
   */
  watchSocialLinks(
    uid: string,
    options: SocialLinksOptions = {}
  ): Observable<IUserSocialLinks | null> {
    const safeUid = this.normalizeUid(uid);
    if (!safeUid) return of(null);

    return this.session.ready$.pipe(
      filter(Boolean),
      switchMap(() => this.session.authUser$),
      map((authUser) => {
        if (!authUser?.uid && !options.allowAnonymousRead) {
          return null;
        }

        return this.buildReadContext(safeUid, authUser?.uid ?? null);
      }),
      distinctUntilChanged((previous, current) =>
        this.sameReadContext(previous, current)
      ),
      switchMap((context) =>
        context
          ? this.getOrCreateFirestoreWatch$(context)
          : of(null)
      ),
      catchError((error) =>
        this.handleError(error, 'watchSocialLinks', options, null)
      )
    );
  }

  /**
   * Salva links sociais privados e opcionalmente atualiza o espelho público.
   */
  saveSocialLinks(
    uid: string,
    links: IUserSocialLinks,
    options: SocialLinksOptions = {}
  ): Observable<void> {
    const safeUid = this.normalizeUid(uid);
    if (!safeUid) {
      return throwError(
        () => new Error('[UserSocialLinks] uid inválido em saveSocialLinks')
      );
    }

    const safeLinks = (links ?? {}) as IUserSocialLinks;

    return this.requireOwner$(safeUid).pipe(
      switchMap((authUid) =>
        this.commitBatchSave$(
          safeUid,
          safeLinks,
          options.publishToPublic
        ).pipe(map(() => authUid))
      ),
      switchMap((authUid) =>
        this.updateCachesAfterSave$(
          safeUid,
          authUid,
          safeLinks,
          options.publishToPublic
        )
      ),
      map(() => {
        this.invalidateInFlightReads(safeUid);
        return void 0;
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

  /**
   * Remove uma chave dos links sociais privados e, quando solicitado, do espelho.
   */
  removeLink(
    uid: string,
    linkKey: keyof IUserSocialLinks,
    options: SocialLinksOptions = {}
  ): Observable<void> {
    const safeUid = this.normalizeUid(uid);
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

    return this.requireOwner$(safeUid).pipe(
      switchMap((authUid) =>
        this.commitBatchRemove$(
          safeUid,
          linkKey,
          options.publishToPublic
        ).pipe(map(() => authUid))
      ),
      switchMap((authUid) =>
        this.updateCachesAfterRemove$(
          safeUid,
          authUid,
          linkKey,
          options.publishToPublic
        )
      ),
      map(() => {
        this.invalidateInFlightReads(safeUid);
        return void 0;
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

  // =============================================================================
  // CONTEXTO DE LEITURA E DEFINIÇÕES DE CACHE
  // =============================================================================

  private resolveOneShotContext$(
    targetUid: string,
    options: SocialLinksOptions
  ): Observable<SocialLinksReadContext> {
    return this.session.ready$.pipe(
      filter(Boolean),
      take(1),
      switchMap(() => this.session.authUser$.pipe(take(1))),
      switchMap((authUser: User | null) => {
        const authUid = authUser?.uid ?? null;

        if (!authUid && !options.allowAnonymousRead) {
          return throwError(() =>
            this.makeError('auth/required', 'Usuário não autenticado.')
          );
        }

        return of(this.buildReadContext(targetUid, authUid));
      })
    );
  }

  private buildReadContext(
    targetUid: string,
    authUid: string | null
  ): SocialLinksReadContext {
    if (authUid && authUid === targetUid) {
      return {
        targetUid,
        authUid,
        kind: 'owner-private',
        path: this.privateSocialLinksPath(targetUid),
        cacheDefinition: this.ownerPrivateDefinition(targetUid, authUid),
      };
    }

    if (authUid) {
      return {
        targetUid,
        authUid,
        kind: 'public-authenticated',
        path: this.publicSocialLinksPath(targetUid),
        cacheDefinition: this.publicAuthenticatedDefinition(
          targetUid,
          authUid
        ),
      };
    }

    return {
      targetUid,
      authUid: null,
      kind: 'public-anonymous',
      path: this.publicSocialLinksPath(targetUid),
      cacheDefinition: this.publicAnonymousDefinition(targetUid),
    };
  }

  private ownerPrivateDefinition(
    targetUid: string,
    ownerUid: string
  ): CacheDefinition<IUserSocialLinks | null> {
    return {
      key: `social-links:private:${targetUid}`,
      scope: 'user',
      ownerUid,
      sensitivity: 'restricted',
      storage: 'memory',
      ttlMs: UserSocialLinksService.CACHE_TTL_MS,
      staleWhileRevalidateMs: UserSocialLinksService.CACHE_STALE_MS,
      version: UserSocialLinksService.CACHE_VERSION,
      validate: (value): value is IUserSocialLinks | null =>
        this.isSocialLinksValue(value),
    };
  }

  private publicAuthenticatedDefinition(
    targetUid: string,
    viewerUid: string
  ): CacheDefinition<IUserSocialLinks | null> {
    return {
      key: `social-links:public:${targetUid}`,
      scope: 'user',
      ownerUid: viewerUid,
      sensitivity: 'private',
      storage: 'memory',
      ttlMs: UserSocialLinksService.CACHE_TTL_MS,
      staleWhileRevalidateMs: UserSocialLinksService.CACHE_STALE_MS,
      version: UserSocialLinksService.CACHE_VERSION,
      validate: (value): value is IUserSocialLinks | null =>
        this.isSocialLinksValue(value),
    };
  }

  private publicAnonymousDefinition(
    targetUid: string
  ): CacheDefinition<IUserSocialLinks | null> {
    return {
      key: `social-links:public:${targetUid}`,
      scope: 'session',
      sensitivity: 'public',
      storage: 'memory',
      ttlMs: UserSocialLinksService.CACHE_TTL_MS,
      staleWhileRevalidateMs: UserSocialLinksService.CACHE_STALE_MS,
      version: UserSocialLinksService.CACHE_VERSION,
      validate: (value): value is IUserSocialLinks | null =>
        this.isSocialLinksValue(value),
    };
  }

  private isSocialLinksValue(
    value: unknown
  ): value is IUserSocialLinks | null {
    return value === null || (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    );
  }

  private sameReadContext(
    previous: SocialLinksReadContext | null,
    current: SocialLinksReadContext | null
  ): boolean {
    if (previous === current) return true;
    if (!previous || !current) return false;

    return (
      previous.path === current.path &&
      previous.kind === current.kind &&
      previous.authUid === current.authUid
    );
  }

  // =============================================================================
  // READ E WATCH COM COALESCÊNCIA
  // =============================================================================

  private getOrCreateFirestoreRead$(
    context: SocialLinksReadContext
  ): Observable<IUserSocialLinks | null> {
    const key = this.inFlightKey(context, 'read');
    const existing = this.inFlightReads.get(key);
    if (existing) return existing;

    const read$ = this.firestoreCtx
      .deferPromise$(() => getDoc(doc(this.db, context.path)))
      .pipe(
        map((snapshot) =>
          snapshot.exists()
            ? this.mapSnapshotData(snapshot.data(), context.kind)
            : null
        ),
        switchMap((links) =>
          this.cache
            .set$(context.cacheDefinition, links)
            .pipe(map(() => links))
        ),
        finalize(() => this.inFlightReads.delete(key)),
        shareReplay({ bufferSize: 1, refCount: true })
      );

    this.inFlightReads.set(key, read$);
    return read$;
  }

  private getOrCreateFirestoreWatch$(
    context: SocialLinksReadContext
  ): Observable<IUserSocialLinks | null> {
    const key = this.inFlightKey(context, 'watch');
    const existing = this.inFlightWatches.get(key);
    if (existing) return existing;

    const watch$ = this.firestoreCtx
      .deferObservable$(() => docSnapshots(doc(this.db, context.path)))
      .pipe(
        map((snapshot) =>
          snapshot.exists()
            ? this.mapSnapshotData(snapshot.data(), context.kind)
            : null
        ),
        switchMap((links) =>
          this.cache
            .set$(context.cacheDefinition, links)
            .pipe(map(() => links))
        ),
        finalize(() => this.inFlightWatches.delete(key)),
        shareReplay({ bufferSize: 1, refCount: true })
      );

    this.inFlightWatches.set(key, watch$);
    return watch$;
  }

  private mapSnapshotData(
    raw: unknown,
    kind: SocialLinksReadKind
  ): IUserSocialLinks {
    if (kind === 'owner-private') {
      return { ...((raw ?? {}) as IUserSocialLinks) };
    }

    return this.sanitizePublicLinks(raw);
  }

  // =============================================================================
  // COMMITS FIRESTORE
  // =============================================================================

  private commitBatchSave$(
    uid: string,
    links: IUserSocialLinks,
    publishToPublic?: boolean
  ): Observable<void> {
    return this.firestoreCtx.deferPromise$(async () => {
      const batch = writeBatch(this.db);
      const privateRef = doc(this.db, this.privateSocialLinksPath(uid));

      batch.set(privateRef, links, { merge: true });

      if (publishToPublic === true) {
        const publicRef = doc(this.db, this.publicSocialLinksPath(uid));
        batch.set(
          publicRef,
          {
            uid,
            ...this.toPublicPayload(links),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } else if (publishToPublic === false) {
        batch.delete(doc(this.db, this.publicSocialLinksPath(uid)));
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
      const privateRef = doc(this.db, this.privateSocialLinksPath(uid));

      const privateRemoval: WithFieldValue<IUserSocialLinks> = {
        [linkKey]: deleteField(),
      };

      batch.set(privateRef, privateRemoval, { merge: true });

      if (publishToPublic === true) {
        const publicRef = doc(this.db, this.publicSocialLinksPath(uid));
        const publicSnapshot = await getDoc(publicRef);

        if (publicSnapshot.exists()) {
          batch.set(
            publicRef,
            {
              [linkKey]: deleteField(),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }
      } else if (publishToPublic === false) {
        batch.delete(doc(this.db, this.publicSocialLinksPath(uid)));
      }

      await batch.commit();
    }).pipe(map(() => void 0));
  }

  // =============================================================================
  // ATUALIZAÇÃO E INVALIDAÇÃO DE CACHE APÓS MUTATIONS
  // =============================================================================

  private updateCachesAfterSave$(
    targetUid: string,
    authUid: string,
    links: IUserSocialLinks,
    publishToPublic?: boolean
  ): Observable<void> {
    const operations: Observable<void>[] = [
      this.cache.set$(
        this.ownerPrivateDefinition(targetUid, authUid),
        links
      ),
    ];

    const publicDefinition = this.publicAuthenticatedDefinition(
      targetUid,
      authUid
    );

    if (publishToPublic === true) {
      operations.push(
        this.cache.set$(publicDefinition, this.toPublicPayload(links))
      );
    } else if (publishToPublic === false) {
      operations.push(this.cache.invalidate$(publicDefinition));
    }

    return forkJoin(operations).pipe(map(() => void 0));
  }

  private updateCachesAfterRemove$(
    targetUid: string,
    authUid: string,
    linkKey: keyof IUserSocialLinks,
    publishToPublic?: boolean
  ): Observable<void> {
    const operations: Observable<void>[] = [
      this.patchCacheAfterRemove$(
        this.ownerPrivateDefinition(targetUid, authUid),
        linkKey
      ),
    ];

    const publicDefinition = this.publicAuthenticatedDefinition(
      targetUid,
      authUid
    );

    if (publishToPublic === true) {
      operations.push(
        this.patchCacheAfterRemove$(publicDefinition, linkKey)
      );
    } else if (publishToPublic === false) {
      operations.push(this.cache.invalidate$(publicDefinition));
    }

    return forkJoin(operations).pipe(map(() => void 0));
  }

  private patchCacheAfterRemove$(
    definition: CacheDefinition<IUserSocialLinks | null>,
    linkKey: keyof IUserSocialLinks
  ): Observable<void> {
    return this.cache.get$(definition).pipe(
      take(1),
      switchMap((result: CacheResult<IUserSocialLinks | null>) => {
        if (result.status === 'miss') {
          return this.cache.invalidate$(definition);
        }

        if (!result.value) {
          return this.cache.set$(definition, null);
        }

        const next = { ...result.value } as Record<string, unknown>;
        delete next[String(linkKey)];

        return this.cache.set$(
          definition,
          next as IUserSocialLinks
        );
      })
    );
  }

  // =============================================================================
  // PAYLOAD PÚBLICO
  // =============================================================================

  private toPublicPayload(
    links: IUserSocialLinks
  ): Partial<IUserSocialLinks> {
    const output: Partial<IUserSocialLinks> = {};

    for (const key of UserSocialLinksService.PUBLIC_KEYS) {
      const value = (links as Record<string, unknown>)?.[key];

      if (typeof value === 'string' || value === null) {
        (output as Record<string, unknown>)[key] = value;
      }
    }

    return output;
  }

  private sanitizePublicLinks(raw: unknown): IUserSocialLinks {
    const source = (
      typeof raw === 'object' && raw !== null
        ? raw
        : {}
    ) as Record<string, unknown>;

    return this.toPublicPayload(source as IUserSocialLinks) as IUserSocialLinks;
  }

  // =============================================================================
  // AUTH
  // =============================================================================

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

  // =============================================================================
  // HELPERS
  // =============================================================================

  private normalizeUid(uid: string): string | null {
    const normalized = String(uid ?? '').trim();
    return normalized || null;
  }

  private privateSocialLinksPath(uid: string): string {
    return `users/${uid}/profileData/socialLinks`;
  }

  private publicSocialLinksPath(uid: string): string {
    return `public_social_links/${uid}`;
  }

  private inFlightKey(
    context: SocialLinksReadContext,
    kind: 'read' | 'watch'
  ): string {
    return [
      kind,
      context.kind,
      context.authUid ?? 'anonymous',
      context.targetUid,
    ].join('::');
  }

  private invalidateInFlightReads(uid: string): void {
    for (const key of Array.from(this.inFlightReads.keys())) {
      if (key.endsWith(`::${uid}`)) {
        this.inFlightReads.delete(key);
      }
    }
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;

    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }

  // =============================================================================
  // ERROS CENTRALIZADOS
  // =============================================================================

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
      // Telemetria não pode derrubar o fluxo principal.
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

  private wrapError(error: unknown, context: string): Error {
    const wrapped =
      error instanceof Error
        ? error
        : new Error(String(error ?? 'unknown error'));

    (wrapped as any).silent = true;
    (wrapped as any).skipUserNotification = true;
    (wrapped as any).feature = 'user-social-links';
    (wrapped as any).context = context;
    (wrapped as any).original = error;

    return wrapped;
  }

  private makeError(code: string, message: string): Error {
    const error = new Error(message);
    (error as any).code = code;
    (error as any).silent = true;
    (error as any).skipUserNotification = true;
    (error as any).feature = 'user-social-links';
    return error;
  }
}
