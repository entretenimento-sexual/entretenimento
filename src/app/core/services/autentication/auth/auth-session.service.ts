// src/app/core/services/autentication/auth/auth-session.service.ts
import { Injectable } from '@angular/core';
import {
  BehaviorSubject,
  Observable,
  Subject,
  combineLatest,
  defer,
  firstValueFrom,
  from,
  merge,
  of,
} from 'rxjs';
import {
  catchError,
  combineLatestWith,
  distinctUntilChanged,
  filter,
  map,
  retry,
  shareReplay,
  startWith,
  switchMap,
  tap,
  timeout,
} from 'rxjs/operators';
import { Auth, User } from '@angular/fire/auth';
// Low-level session observers subscribe lazily, outside Angular DI. Use the
// same native Auth transport for both listeners; the injected Auth is unchanged.
import { onAuthStateChanged, onIdTokenChanged } from 'firebase/auth';

import { readAuthInvalidUid } from '@core/firebase/auth-invalid-session-marker';
import { FIREBASE_AUTH_RESTORE_TIMEOUT_MS } from '@core/firebase/firebase-runtime.constants';
import { AuthAppBlockService } from './auth-app-block.service';
import { authInvalidationReason } from './auth.types';
import { PrivacyDebugLoggerService } from '../../privacy/privacy-debug-logger.service';

interface AuthUserState {
  readonly user: User | null;
  readonly uid: string | null;
  readonly emailVerified: boolean;
}

function snapshotAuthUser(user: User | null): AuthUserState {
  return {
    user,
    uid: user?.uid ?? null,
    emailVerified: user?.emailVerified === true,
  };
}

function sameAuthUserState(previous: AuthUserState, current: AuthUserState): boolean {
  // UID and e-mail may be identical after the SDK replaces the User object.
  // Preserve the operational identity for session-scoped consumers.
  return previous.user === current.user && previous.uid === current.uid &&
    previous.emailVerified === current.emailVerified;
}

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

  private terminationVersion = 0;
  private lastObservedUser: User | null = null;
  private lastEmittedUser: User | null = null;
  private readyPromise: Promise<void> | null = null;
  private readonly sdkReady$: Observable<void>;
  private readonly manualAuthUserRefresh$ = new Subject<User | null>();
  private readonly terminationSubject = new BehaviorSubject<boolean>(false);

  constructor(
    private readonly auth: Auth,
    private readonly privacyDebug: PrivacyDebugLoggerService,
    private readonly appBlock: AuthAppBlockService
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
      tap({ error: (error: unknown) => this.dbg('onIdTokenChanged error', error) }),
      retry({ delay: 1_000, resetOnSuccess: true })
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
      filter((user) => user === this.auth.currentUser),
      tap((user) => {
        const previous = this.lastEmittedUser;
        this.lastEmittedUser = user;
        if (!user || user === previous) return;
        this.lastObservedUser = user;
        const reason = readAuthInvalidUid(user.uid);
        if (reason) this.appBlock.applyInvalidation(user.uid, reason, true);
      }),
      map(snapshotAuthUser),
      distinctUntilChanged(sameAuthUserState),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.authUser$ = combineLatest([
      firebaseAuthUser$,
      this.isTerminating$,
    ]).pipe(
      map(([state, terminating]) => terminating ? snapshotAuthUser(null) : state),
      distinctUntilChanged(sameAuthUserState),
      map((state) => state.user),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.uid$ = this.authUser$.pipe(
      map((user) => user?.uid ?? null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    const authWithReady = this.auth as Auth & {
      authStateReady?: () => Promise<void>;
    };
    // As tentativas da aplicação compartilham a mesma inicialização pendente do SDK.
    this.sdkReady$ = defer(() =>
      authWithReady.authStateReady?.() ?? new Observable<void>((subscriber) =>
        onAuthStateChanged(this.auth, () => {
          subscriber.next();
          subscriber.complete();
        }, (error) => subscriber.error(error))
      )
    ).pipe(shareReplay({ bufferSize: 1, refCount: false }));

    this.ready$ = defer(() => from(this.whenReady())).pipe(
      map(() => true),
      startWith(false),
      tap({ error: (error: unknown) => this.dbg('ready$ error', error) }),
      retry({ delay: 1_000 }),
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
    this.terminationVersion++;
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

  get terminationVersionSnapshot(): number {
    return this.terminationVersion;
  }

  recordReloadFailure(user: User, previousTermination: number, error: unknown): boolean {
    const active = this.auth.currentUser;
    const reason = authInvalidationReason(error);
    if (!reason || this.isTerminatingSnapshot || previousTermination !== this.terminationVersion ||
        (active !== null && active !== user) ||
        (active === null && this.lastObservedUser !== null && this.lastObservedUser !== user)) return false;

    this.appBlock.recordInvalidation(user.uid, reason, active === user);
    return true;
  }

  get isTerminatingSnapshot(): boolean {
    return this.terminationSubject.value;
  }

  whenReady(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = firstValueFrom(
      this.sdkReady$.pipe(timeout({ first: FIREBASE_AUTH_RESTORE_TIMEOUT_MS }))
    )
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

  refreshCurrentUser$({ requireFresh = false } = {}): Observable<User | null> {
    return defer(() => {
      const user = this.auth.currentUser;

      if (!user) {
        this.manualAuthUserRefresh$.next(null);
        return of(null);
      }

      const termination = this.terminationVersion;
      const isCurrentSession = () => this.auth.currentUser === user &&
        !this.isTerminatingSnapshot && this.terminationVersion === termination;
      // O SDK pode cancelar a assinatura ao emitir null antes de rejeitar.
      const reload = Promise.resolve().then(() =>
        isCurrentSession() ? user.reload() : undefined
      ).then(() =>
        isCurrentSession() ? user.getIdToken(true) : undefined
      ).catch((error: unknown) => {
        this.recordReloadFailure(user, termination, error);
        throw error;
      });
      return from(reload).pipe(
        map(() => isCurrentSession() ? user : null),
        tap((refreshedUser) => {
          if (refreshedUser) this.manualAuthUserRefresh$.next(refreshedUser);
        }),
        catchError((error: unknown) => {
          this.dbg('refreshCurrentUser$ error', error);
          if (!isCurrentSession()) return of(null);
          if (requireFresh) throw error;
          this.manualAuthUserRefresh$.next(user);
          return of(user);
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
