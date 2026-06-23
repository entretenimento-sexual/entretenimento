// src/app/core/services/autentication/auth/auth-session.service.ts
// -----------------------------------------------------------------------------
// AUTH SESSION SERVICE
// -----------------------------------------------------------------------------
// Fonte única da sessão real do Firebase/Auth.
//
// Responsabilidades:
// - expor o usuário autenticado real do Firebase;
// - expor uid$, ready$ e emailVerified$;
// - oferecer utilitário whenReady() para bootstrap seguro;
// - oferecer readyAuthUser$ / readyUid$ para leituras Firestore após bootstrap
//   e com token já validado.
//
// Não faz:
// - não busca perfil do app (IUserDados);
// - não decide acesso de produto;
// - não orquestra watchers de Firestore.
//
// Observação arquitetural:
// - AuthSessionService = verdade da sessão;
// - CurrentUserStoreService = verdade do perfil do app;
// - LogoutService = dono do signOut com side-effects.
// -----------------------------------------------------------------------------

import { EnvironmentInjector, Injectable, runInInjectionContext } from '@angular/core';
import { Observable, defer, from, of } from 'rxjs';
import {
  catchError,
  combineLatestWith,
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs/operators';
import {
  Auth,
  onAuthStateChanged,
  signOut,
  User,
} from '@angular/fire/auth';
import { onIdTokenChanged } from 'firebase/auth';

import { PrivacyDebugLoggerService } from '../../privacy/privacy-debug-logger.service';

@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  /** Usuário real do Firebase Auth. Fonte única da sessão autenticada. */
  readonly authUser$: Observable<User | null>;

  /** UID derivado do authUser$. Pode emitir antes do ready$ virar true. */
  readonly uid$: Observable<string | null>;

  /** TRUE quando o Firebase Auth terminou de restaurar o estado inicial. */
  readonly ready$: Observable<boolean>;

  /** Email verificado segundo o Firebase Auth, já considerando ready$. */
  readonly emailVerified$: Observable<boolean>;

  /** Conveniência: usuário autenticado após bootstrap resolvido. */
  readonly isAuthenticated$: Observable<boolean>;

  /**
   * Usuário autenticado após bootstrap + validação de token.
   * Use em leituras Firestore sensíveis que dependem do UID real do Auth.
   */
  readonly readyAuthUser$: Observable<User | null>;

  /** UID autenticado após bootstrap + validação de token. */
  readonly readyUid$: Observable<string | null>;

  /** Cache da promise de bootstrap para manter idempotência. */
  private readyPromise: Promise<void> | null = null;

  constructor(
    private readonly auth: Auth,
    private readonly envInjector: EnvironmentInjector,
    private readonly privacyDebug: PrivacyDebugLoggerService
  ) {
    this.authUser$ = new Observable<User | null>((subscriber) => {
      const unsub = onIdTokenChanged(
        this.auth,
        (user) => subscriber.next(user),
        (err) => subscriber.error(err)
      );
      return () => unsub();
    }).pipe(
      distinctUntilChanged(
        (a, b) =>
          (a?.uid ?? null) === (b?.uid ?? null) &&
          (a?.emailVerified ?? false) === (b?.emailVerified ?? false)
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.uid$ = this.authUser$.pipe(
      map((user) => user?.uid ?? null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.ready$ = defer(() => from(this.whenReady())).pipe(
      map(() => true),
      startWith(false),
      catchError((err) => {
        this.dbg('ready$ error', err);
        return of(true);
      }),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.emailVerified$ = this.ready$.pipe(
      combineLatestWith(this.authUser$),
      map(([ready, user]) => ready === true && user?.emailVerified === true),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.isAuthenticated$ = this.ready$.pipe(
      combineLatestWith(this.authUser$),
      map(([ready, user]) => ready === true && !!user?.uid),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.readyAuthUser$ = this.ready$.pipe(
      combineLatestWith(this.authUser$),
      switchMap(([ready, user]) => {
        const uid = String(user?.uid ?? '').trim();

        if (ready !== true || !uid || !user) {
          return of(null);
        }

        return defer(() => from(user.getIdToken())).pipe(
          map(() => user),
          catchError((err) => {
            this.dbg('readyAuthUser$ token error', err);
            return of(null);
          })
        );
      }),
      distinctUntilChanged(
        (a, b) =>
          (a?.uid ?? null) === (b?.uid ?? null) &&
          (a?.emailVerified ?? false) === (b?.emailVerified ?? false)
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.readyUid$ = this.readyAuthUser$.pipe(
      map((user) => user?.uid ?? null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /**
   * whenReady():
   * - prefere authStateReady() quando existir;
   * - fallback para onAuthStateChanged();
   * - resolve uma única vez por ciclo de vida do serviço.
   */
  whenReady(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;

    const authAny = this.auth as any;

    const basePromise: Promise<void> =
      typeof authAny?.authStateReady === 'function'
        ? Promise.resolve(authAny.authStateReady()).then(() => void 0)
        : new Promise<void>((resolve, reject) => {
            const unsubscribe = onAuthStateChanged(
              this.auth,
              (user) => {
                this.dbg('whenReady resolved (onAuthStateChanged)', {
                  uid: user?.uid ?? null,
                });
                resolve();
                unsubscribe();
              },
              (err) => {
                this.dbg('whenReady rejected (onAuthStateChanged)', err);
                reject(err);
                unsubscribe();
              }
            );
          });

    this.readyPromise = basePromise.then(() => {
      this.dbg('whenReady resolved', {
        uid: this.auth.currentUser?.uid ?? null,
      });
    });

    return this.readyPromise;
  }

  /**
   * Compat API. Preferir LogoutService para sair da sessão porque lá vivem
   * presença, navegação e limpeza coordenada.
   */
  signOut$(): Observable<void> {
    return defer(() =>
      from(runInInjectionContext(this.envInjector, () => signOut(this.auth)))
    ).pipe(map(() => void 0));
  }

  /** Snapshot síncrono do usuário autenticado atual. Usar só defensivamente. */
  get currentAuthUser(): User | null {
    return this.auth.currentUser;
  }

  /** Debug seguro da sessão Firebase/Auth. */
  private dbg(message: string, extra?: unknown): void {
    this.privacyDebug.log('auth', `AuthSessionService: ${message}`, extra);
  }
}
