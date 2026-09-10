// src/app/core/services/autentication/auth/auth-session.service.ts
import { Injectable } from '@angular/core';
import {
  BehaviorSubject,
  Observable,
  Subject,
  combineLatest,
  defer,
  from,
  merge,
  of,
} from 'rxjs';
import {
  catchError,
  combineLatestWith,
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
  switchMap,
  tap,
} from 'rxjs/operators';
import {
  Auth,
  onAuthStateChanged,
  User,
} from '@angular/fire/auth';
import { onIdTokenChanged } from 'firebase/auth';

import { PrivacyDebugLoggerService } from '../../privacy/privacy-debug-logger.service';

@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  readonly authUser$: Observable<User | null>;
  readonly uid$: Observable<string | null>;
  readonly ready$: Observable<boolean>;
  readonly emailVerified$: Observable<boolean>;
  readonly isAuthenticated$: Observable<boolean>;
  readonly readyAuthUser$: Observable<User | null>;
  readonly readyUid$: Observable<string | null>;
  readonly isTerminating$: Observable<boolean>;

  private readyPromise: Promise<void> | null = null;
  private readonly manualAuthUserRefresh$ = new Subject<User | null>();
  private readonly terminationSubject = new BehaviorSubject<boolean>(false);

  constructor(
    private readonly auth: Auth,
    private readonly privacyDebug: PrivacyDebugLoggerService
  ) {
    this.isTerminating$ = this.terminationSubject.asObservable().pipe(
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    const idTokenUser$ = new Observable<User | null>((subscriber) => {
      const unsubscribe = onIdTokenChanged(
        this.auth,
        (user) => subscriber.next(user),
        (error) => subscriber.error(error)
      );
      return () => unsubscribe();
    }).pipe(
      catchError((error: unknown) => {
        this.dbg('onIdTokenChanged error', error);
        /**
         * Falha fechada:
         * - não inventa UID;
         * - emite apenas o snapshot local disponível;
         * - o canal manual continua apto a publicar refresh posterior.
         */
        return of(this.auth.currentUser ?? null);
      })
    );

    /**
     * Firebase continua sendo a verdade técnica da autenticação. Durante um
     * encerramento, porém, a sessão deixa de ser operacional imediatamente.
     * Mantemos o snapshot técnico em `auth.currentUser` para que o LogoutService
     * ainda possa concluir callables/cleanup autenticados antes do signOut.
     *
     * Ao mascarar `authUser$` enquanto `terminationSubject=true`, toda a camada
     * Angular que consome AuthSessionService recebe `null` no mesmo ciclo:
     * guards, AccessControl, NgRx, listeners e caches deixam de operar para o UID.
     * Se o signOut voluntário falhar, `endTermination()` restaura atomicamente o
     * mesmo Firebase user e os orquestradores rearmam a sessão canônica.
     */
    const firebaseAuthUser$ = merge(
      idTokenUser$,
      this.manualAuthUserRefresh$
    ).pipe(
      distinctUntilChanged(
        (previous, current) =>
          previous?.uid === current?.uid &&
          previous?.emailVerified === current?.emailVerified
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.authUser$ = combineLatest([
      firebaseAuthUser$,
      this.isTerminating$,
    ]).pipe(
      map(([user, terminating]) => terminating ? null : user),
      distinctUntilChanged(
        (previous, current) =>
          previous?.uid === current?.uid &&
          previous?.emailVerified === current?.emailVerified
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
      catchError((error: unknown) => {
        this.dbg('ready$ error', error);
        /**
         * `ready=true` encerra o estado de espera, mas authUser$ continuará nulo
         * quando não houver uma sessão confirmada. Guards podem então encaminhar
         * ao login em vez de permanecerem presos em loading infinito.
         */
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
          catchError((error: unknown) => {
            this.dbg('readyAuthUser$ token error', error);
            return of(null);
          })
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.readyUid$ = this.readyAuthUser$.pipe(
      map((user) => user?.uid ?? null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /**
   * Marca o começo do encerramento global da sessão.
   * Somente o LogoutService deve coordenar esta transição.
   */
  beginTermination(): void {
    if (this.terminationSubject.value) return;

    this.dbg('beginTermination()', {
      hasFirebaseUser: !!this.auth.currentUser?.uid,
    });
    this.terminationSubject.next(true);
  }

  /**
   * Finaliza o estado transitório de encerramento.
   * - após signOut confirmado, o Firebase user já é null;
   * - após falha do logout voluntário, reexpõe a sessão técnica ainda válida.
   */
  endTermination(): void {
    if (!this.terminationSubject.value) return;

    this.dbg('endTermination()', {
      hasFirebaseUser: !!this.auth.currentUser?.uid,
    });
    this.terminationSubject.next(false);
  }

  get isTerminatingSnapshot(): boolean {
    return this.terminationSubject.value;
  }

  whenReady(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;

    const authWithReady = this.auth as Auth & {
      authStateReady?: () => Promise<void>;
    };

    const basePromise: Promise<void> =
      typeof authWithReady.authStateReady === 'function'
        ? Promise.resolve(authWithReady.authStateReady()).then(() => void 0)
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
              (error) => {
                this.dbg('whenReady rejected (onAuthStateChanged)', error);
                reject(error);
                unsubscribe();
              }
            );
          });

    this.readyPromise = basePromise
      .then(() => {
        this.dbg('whenReady resolved', {
          uid: this.auth.currentUser?.uid ?? null,
        });
      })
      .catch((error: unknown) => {
        /**
         * A promessa rejeitada não pode ficar memorizada: a próxima chamada deve
         * poder tentar novamente após uma oscilação de rede/emulador.
         */
        this.readyPromise = null;
        throw error;
      });

    return this.readyPromise;
  }

  refreshCurrentUser$(): Observable<User | null> {
    return defer(() => {
      const user = this.auth.currentUser;

      if (!user) {
        this.manualAuthUserRefresh$.next(null);
        return of(null);
      }

      return from(user.reload()).pipe(
        switchMap(() => from(user.getIdToken(true))),
        map(() => this.auth.currentUser ?? user),
        tap((refreshedUser) => {
          this.manualAuthUserRefresh$.next(refreshedUser);
        }),
        catchError((error: unknown) => {
          this.dbg('refreshCurrentUser$ error', error);
          const fallback = this.auth.currentUser ?? null;
          this.manualAuthUserRefresh$.next(fallback);
          return of(fallback);
        })
      );
    });
  }

  get currentAuthUser(): User | null {
    return this.auth.currentUser;
  }

  private dbg(message: string, extra?: unknown): void {
    this.privacyDebug.log('auth', `AuthSessionService: ${message}`, extra);
  }
}
