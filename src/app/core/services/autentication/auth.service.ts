//src\app\core\services\autentication\auth.service.ts
import { Injectable, Injector, Inject } from '@angular/core';
import { Observable, BehaviorSubject, of, from } from 'rxjs';
import { switchMap, tap, catchError, distinctUntilChanged, map, shareReplay, timeout, retry } from 'rxjs/operators';
import { Router } from '@angular/router';
import { IUserDados } from '../../interfaces/iuser-dados';
import { UsuarioService } from '../user-profile/usuario.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { Store } from '@ngrx/store';
import { AppState } from '../../../store/states/app.state';
import { loginSuccess, logoutSuccess } from '../../../store/actions/actions.user/auth.actions';
import { setCurrentUser } from 'src/app/store/actions/actions.user/user.actions';
import { FirestoreService } from '../data-handling/firestore.service';
import { FirestoreUserQueryService } from '../data-handling/firestore-user-query.service';
import { CacheService } from '../general/cache/cache.service';
import { EmailVerificationService } from './register/email-verification.service';
import { GeolocationTrackingService } from '../geolocation/geolocation-tracking.service';
import { FIREBASE_AUTH } from '../../firebase/firebase.tokens';
import type { Auth, User } from 'firebase/auth';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, updateDoc, serverTimestamp as fsServerTimestamp } from 'firebase/firestore';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private userSubject = new BehaviorSubject<IUserDados | null>(null);
  private cachedUid$: Observable<string | null> | null = null;
  private heartbeatTimer: any = null;
  private beforeUnloadHandler?: () => void;
  user$: Observable<IUserDados | null> = this.userSubject.asObservable();
  private readonly NET_TIMEOUT_MS = 10000;

  constructor(
    @Inject(Router) private router: Router,
    private injector: Injector,
    private firestoreUserQuery: FirestoreUserQueryService,
    private globalErrorHandlerService: GlobalErrorHandlerService,
    private cacheService: CacheService,
    private store: Store<AppState>,
    private emailVerificationService: EmailVerificationService,
    private geoloc: GeolocationTrackingService,
    private firestoreService: FirestoreService,
    @Inject(FIREBASE_AUTH) private auth: Auth,
  ) {
    this.initAuthStateListener();
  }

  private get usuarioService(): UsuarioService {
    return this.injector.get(UsuarioService);
  }

  private startHeartbeat(uid: string): void {
    if (this.heartbeatTimer) return;
    const fs = this.firestoreService.getFirestoreInstance();
    const userRef = doc(fs, 'users', uid);
    const tick = () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      updateDoc(userRef, { isOnline: true, lastSeen: fsServerTimestamp() }).catch(() => { });
    };
    tick();
    this.heartbeatTimer = setInterval(tick, 30_000);
    this.beforeUnloadHandler = () => {
      updateDoc(userRef, { isOnline: false, lastSeen: fsServerTimestamp() }).catch(() => { });
    };
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
    window.addEventListener('offline', () => {
      updateDoc(userRef, { isOnline: false, lastSeen: fsServerTimestamp() }).catch(() => { });
    });
    window.addEventListener('online', () => tick());
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      this.beforeUnloadHandler = undefined;
    }
  }

  private buildMinimalUserFromAuth(u: User): IUserDados {
    return {
      uid: u.uid,
      email: u.email ?? '',
      nickname: u.displayName ?? (u.email ? u.email.split('@')[0] : 'Usuário'),
      emailVerified: !!u.emailVerified,
      isSubscriber: false,
      profileCompleted: false,
      role: 'basico' as any,
    } as IUserDados;
  }

  private initAuthStateListener(): void {
    new Observable<User | null>((observer) => {
      const unsub = onAuthStateChanged(
        this.auth,
        (user) => observer.next(user),
        (err) => observer.error?.(err)
      );
      return () => unsub();
    })
      .pipe(
        switchMap((user) => {
          if (!user) {
            this.clearCurrentUser();
            return of(null);
          }
          const cachedUser = this.userSubject.value;
          if (cachedUser?.uid === user.uid) {
            return of(cachedUser);
          }
          return this.cacheService.get<IUserDados>('currentUser').pipe(
            switchMap((cachedData) => {
              if (cachedData?.uid === user.uid) {
                return of(cachedData);
              }
              const localUserData = localStorage.getItem('currentUser');
              if (localUserData) {
                const parsedUser = JSON.parse(localUserData) as IUserDados;
                if (parsedUser?.uid === user.uid) {
                  return of(parsedUser);
                }
              }
              return this.firestoreUserQuery.getUser(user.uid).pipe(
                retry({ count: 5, delay: 300 }),
                timeout({ each: this.NET_TIMEOUT_MS }),
                catchError(() => of(null)),
                switchMap(userData => {
                  if (userData) return of(userData);
                  const createdAt = Date.parse(user.metadata.creationTime || '');
                  const freshSignup = Number.isFinite(createdAt) && (Date.now() - createdAt) <= 90_000;
                  return freshSignup ? of(this.buildMinimalUserFromAuth(user)) : of(null);
                })
              );
            })
          );
        }),
        tap((userData) => {
          if (userData) {
            this.userSubject.next(userData);
            localStorage.setItem('currentUser', JSON.stringify(userData));
            this.cacheService.set('currentUser', userData, 300000);
            this.cacheService.set('currentUserUid', userData.uid, 300000);
            this.store.dispatch(loginSuccess({ user: userData }));
            this.store.dispatch(setCurrentUser({ user: userData }));
            this.startHeartbeat(userData.uid);
            const authUser = this.auth.currentUser;
            if (authUser?.emailVerified && userData.emailVerified !== true) {
              this.emailVerificationService
                .updateEmailVerificationStatus(authUser.uid, true)
                .subscribe({ next: () => { }, error: () => { } });
            }
            return;
          }
          this.clearCurrentUser();
          this.geoloc.stopTracking();
        }),
        catchError((error) => {
          this.globalErrorHandlerService.handleError(error);
          return of(null);
        }),
        shareReplay(1)
      )
      .subscribe();
  }

  get currentUser(): IUserDados | null {
    return this.userSubject.value;
  }

  isAuthenticated(): boolean {
    return this.userSubject.value !== null;
  }

  getLoggedUserUID$(): Observable<string | null> {
    if (!this.cachedUid$) {
      this.cachedUid$ = this.cacheService.get<string>('currentUserUid').pipe(
        distinctUntilChanged(),
        switchMap(cachedUid => {
          if (cachedUid) {
            return of(cachedUid);
          }
          const authUser = this.auth.currentUser;
          if (authUser?.uid) {
            this.cacheService.set('currentUserUid', authUser.uid, 300000);
            return of(authUser.uid);
          }
          return of(null);
        }),
        tap(uid => { if (!uid) { } }),
        catchError(error => {
          this.globalErrorHandlerService.handleError(error);
          return of(null);
        }),
        shareReplay(1)
      );
    }
    return this.cachedUid$;
  }

  public logoutAndClearUser(): void {
    this.clearCurrentUser();
  }

  private clearCurrentUser(): void {
    this.stopHeartbeat();
    this.userSubject.next(null);
    localStorage.removeItem('currentUser');
    this.cachedUid$ = null;
    this.store.dispatch(logoutSuccess());
  }

  setCurrentUser(userData: IUserDados): void {
    if (!userData || !userData.uid) return;
    if (JSON.stringify(this.currentUser) !== JSON.stringify(userData)) {
      this.userSubject.next(userData);
      localStorage.setItem('currentUser', JSON.stringify(userData));
      this.cacheService.set('currentUserUid', userData.uid, 300000);
      this.store.dispatch(setCurrentUser({ user: userData }));
    }
  }

  logout(): Observable<void> {
    return this.getLoggedUserUID$().pipe(
      switchMap((uid) => {
        if (!uid) return of(void 0);
        this.stopHeartbeat();
        return this.usuarioService.updateUserOnlineStatus(uid, false).pipe(
          tap(() => { }),
          switchMap(() => from(signOut(this.auth)).pipe(timeout({ each: this.NET_TIMEOUT_MS }))),
          tap(() => {
            this.clearCurrentUser();
            this.store.dispatch(logoutSuccess());
            this.geoloc.stopTracking();
          }),
          switchMap(() => from(this.router.navigate(['/login']))),
          map(() => void 0),
          catchError(() => of(void 0))
        );
      })
    );
  }
}
