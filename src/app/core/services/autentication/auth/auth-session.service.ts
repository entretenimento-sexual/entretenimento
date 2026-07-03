// src/app/core/services/autentication/auth/auth-session.service.ts
import { EnvironmentInjector, Injectable, runInInjectionContext } from '@angular/core';
import { Observable, Subject, defer, from, merge, of } from 'rxjs';
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
  signOut,
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

  private readyPromise: Promise<void> | null = null;
  private readonly manualAuthUserRefresh$ = new Subject<User | null>();

  constructor(
    private readonly auth: Auth,
    private readonly envInjector: EnvironmentInjector,
    private readonly privacyDebug: PrivacyDebugLoggerService
  ) {
    const idTokenUser$ = new Observable<User | null>((subscriber) => {
      const unsub = onIdTokenChanged(
        this.auth,
        (user) => subscriber.next(user),
        (err) => subscriber.error(err)
      );
      return () => unsub();
    });

    this.authUser$ = merge(idTokenUser$, this.manualAuthUserRefresh$).pipe(
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
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.readyUid$ = this.readyAuthUser$.pipe(
      map((user) => user?.uid ?? null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

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
        catchError((err) => {
          this.dbg('refreshCurrentUser$ error', err);
          const fallback = this.auth.currentUser ?? null;
          this.manualAuthUserRefresh$.next(fallback);
          return of(fallback);
        })
      );
    });
  }

  signOut$(): Observable<void> {
    return defer(() =>
      from(runInInjectionContext(this.envInjector, () => signOut(this.auth)))
    ).pipe(map(() => void 0));
  }

  get currentAuthUser(): User | null {
    return this.auth.currentUser;
  }

  private dbg(message: string, extra?: unknown): void {
    this.privacyDebug.log('auth', `AuthSessionService: ${message}`, extra);
  }
}
