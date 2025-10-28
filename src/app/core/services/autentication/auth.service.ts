// src/app/core/services/autentication/auth.service.ts
//sendo descontinuado
import { Injectable, Injector, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, BehaviorSubject, of, from } from 'rxjs';
import { switchMap, tap, catchError, distinctUntilChanged, map, shareReplay, timeout, retry, take } from 'rxjs/operators';

import { Store } from '@ngrx/store';
import { AppState } from '../../../store/states/app.state';
import { loginSuccess, logoutSuccess } from '../../../store/actions/actions.user/auth.actions';
import { setCurrentUser } from 'src/app/store/actions/actions.user/user.actions';

import { IUserDados } from '../../interfaces/iuser-dados';
import { UsuarioService } from '../user-profile/usuario.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { FirestoreUserQueryService } from '../data-handling/firestore-user-query.service';
import { CacheService } from '../general/cache/cache.service';
import { EmailVerificationService } from './register/email-verification.service';
import { GeolocationTrackingService } from '../geolocation/geolocation-tracking.service';

import { Auth, authState, signOut, type User } from '@angular/fire/auth';
import { serverTimestamp as fsServerTimestamp, Firestore } from '@angular/fire/firestore';
import { PresenceService } from './auth/presence.service';
import { DateTimeService } from '../general/date-time.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private userSubject = new BehaviorSubject<IUserDados | null>(null);
  user$: Observable<IUserDados | null> = this.userSubject.asObservable();

  private cachedUid$: Observable<string | null> | null = null;
  private readonly NET_TIMEOUT_MS = 10000;

  constructor(
    private router: Router,
    private firestoreUserQuery: FirestoreUserQueryService,
    private globalErrorHandlerService: GlobalErrorHandlerService,
    private cacheService: CacheService,
    private presence: PresenceService,
    private store: Store<AppState>,
    private emailVerificationService: EmailVerificationService,
    private geoloc: GeolocationTrackingService,
    private usuarioService: UsuarioService,
    private dateTime: DateTimeService,
    private injector: Injector,
    private auth: Auth,
    private db: Firestore
  ) {
    this.initAuthStateListener();
  }

  /** Helper para garantir contexto de injeção em qualquer callback async */
  private afRun<T>(fn: () => T): T {
    return runInInjectionContext(this.injector, fn);
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
    authState(this.auth).pipe(
      switchMap((user) => {
        if (!user) {
          this.clearCurrentUser();
          return of(null);
        }
        const cachedUser = this.userSubject.value;
        if (cachedUser?.uid === user.uid) return of(cachedUser);
        return this.cacheService.get<IUserDados>('currentUser').pipe(
          switchMap((cachedData) => {
            if (cachedData?.uid === user.uid) return of(cachedData);
            const localUserData = localStorage.getItem('currentUser');
            if (localUserData) {
              const parsedUser = JSON.parse(localUserData) as IUserDados;
              if (parsedUser?.uid === user.uid) return of(parsedUser);
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
          this.setCurrentUser(userData);
          this.presence.start(userData.uid);
          const authUser = this.auth.currentUser;
          if (authUser?.emailVerified && userData.emailVerified !== true) {
            this.emailVerificationService
              .updateEmailVerificationStatus(authUser.uid, true)
              .subscribe({ next: () => { }, error: () => { } });
          }
        } else {
          this.presence.stop();
          this.clearCurrentUser();
          this.geoloc.stopTracking();
        }
      }),
      catchError((error) => {
        this.globalErrorHandlerService.handleError(error);
        return of(null);
      }),
      shareReplay(1)
    ).subscribe();
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
          if (cachedUid) return of(cachedUid);
          const authUser = this.auth.currentUser;
          if (authUser?.uid) {
            this.cacheService.set('currentUserUid', authUser.uid, 300000);
            return of(authUser.uid);
          }
          return of(null);
        }),
        catchError(error => {
          this.globalErrorHandlerService.handleError(error);
          return of(null);
        }),
        shareReplay(1)
      );
    }
    return this.cachedUid$;
  }

  private clearCurrentUser(): void {
    this.presence.stop();
    this.userSubject.next(null);
    localStorage.removeItem('currentUser');
    this.cachedUid$ = null;
    this.store.dispatch(logoutSuccess());
  }

  private toEpoch(v: any): number | null { return this.dateTime.toEpoch(v); }
  private serializeUser(u: IUserDados): IUserDados {
    return {
      ...u,
      lastLogin: this.toEpoch(u.lastLogin) ?? 0,
      firstLogin: this.toEpoch(u.firstLogin) as any,
      createdAt: this.toEpoch(u.createdAt) as any,
      singleRoomCreationRightExpires: this.toEpoch(u.singleRoomCreationRightExpires) as any,
      roomCreationSubscriptionExpires: this.toEpoch(u.roomCreationSubscriptionExpires) as any,
      subscriptionExpires: this.toEpoch(u.subscriptionExpires) as any,
    } as any;
  }

  setCurrentUser(userData: IUserDados): void {
    if (!userData || !userData.uid) return;
    if (JSON.stringify(this.currentUser) !== JSON.stringify(userData)) {
      const serial = this.serializeUser(userData); // ✅ datas como epoch
      this.userSubject.next(serial);
      localStorage.setItem('currentUser', JSON.stringify(serial));
      this.cacheService.set('currentUser', serial, 300000);
      this.cacheService.set('currentUserUid', serial.uid, 300000);

      // ✅ também despacha serializado
      this.store.dispatch(loginSuccess({ user: serial }));
      this.store.dispatch(setCurrentUser({ user: serial }));
    }
  }


  logout(): Observable<void> {
    return this.getLoggedUserUID$().pipe(
      take(1),
      switchMap((uid) => {
        if (!uid) return of(void 0);
        this.presence.stop();
        // ⚠️ NÃO engula erro aqui: deixe o log aparecer se falhar
        return this.usuarioService.updateUserOnlineStatus(uid, false).pipe(
          switchMap(() => from(signOut(this.auth))),
          tap(() => {
            this.clearCurrentUser();
            this.geoloc.stopTracking();
          }),
          switchMap(() => from(this.router.navigate(['/login']))),
          map(() => void 0)
        );
      }),
      catchError((err) => {
        console.error('[AuthService.logout] falhou ao setar offline:', err);
        // Mesmo se falhar, finalize a sessão local p/ não travar o usuário
        this.clearCurrentUser();
        this.geoloc.stopTracking();
        return of(void 0);
      })
    );
  }
}
