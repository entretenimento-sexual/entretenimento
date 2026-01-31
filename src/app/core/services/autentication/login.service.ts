// src/app/core/services/autentication/login.service.ts
import { Injectable, NgZone } from '@angular/core';
import { Observable, of, from, iif, defer, firstValueFrom } from 'rxjs';
import { catchError, map, switchMap, timeout, retry, take } from 'rxjs/operators';

import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail as sendPasswordResetEmailFn,
  confirmPasswordReset,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  EmailAuthProvider,
  reauthenticateWithCredential,
  type Persistence,
  type User,
} from 'firebase/auth';

import { Auth } from '@angular/fire/auth';
import { Firestore, doc, setDoc, serverTimestamp } from '@angular/fire/firestore';

import { GeolocationTrackingService } from '../geolocation/geolocation-tracking.service';
import { IUserDados } from '../../interfaces/iuser-dados';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { FirestoreUserQueryService } from '../data-handling/firestore-user-query.service';
import { EmailVerificationService } from './register/email-verification.service';
import { environment } from 'src/environments/environment';
import { CurrentUserStoreService } from './auth/current-user-store.service';

import { FirestoreContextService } from '@core/services/data-handling/firestore/core/firestore-context.service';
import { FirestoreUserWriteService } from '../data-handling/firestore-user-write.service';

export interface LoginResult {
  success: boolean;
  emailVerified?: boolean;
  user?: IUserDados;
  code?: string;
  message?: string;
  needsProfileCompletion?: boolean;
}

@Injectable({ providedIn: 'root' })
export class LoginService {
  private readonly NET_TIMEOUT_MS = 12_000;

  constructor(
    private readonly firestoreUserQuery: FirestoreUserQueryService,
    private readonly userWrite: FirestoreUserWriteService, // mantido (mesmo que aqui não use)
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly geoloc: GeolocationTrackingService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly auth: Auth,
    private readonly firestore: Firestore,
    private readonly ctx: FirestoreContextService,
    private readonly zone: NgZone
  ) { }

  /** Emulador ligado? */
  private isAuthEmuActive(): boolean {
    const cfg: any = environment as any;
    return !environment.production && !!cfg?.emulators?.auth?.host && !!cfg?.emulators?.auth?.port;
  }

  // ---------------------------------------------------------------------------
  // Persistência
  // ---------------------------------------------------------------------------
  setSessionPersistence$(
    modeOrPersistence: 'local' | 'session' | 'none' | Persistence
  ): Observable<void> {
    const persistence = this.resolvePersistence(modeOrPersistence);

    return this.ctx.deferPromise$(() => setPersistence(this.auth, persistence)).pipe(
      map(() => void 0),
      catchError((err) => {
        // fallback seguro
        return this.ctx.deferPromise$(() => setPersistence(this.auth, inMemoryPersistence)).pipe(
          map(() => void 0),
          catchError((err2) => {
            try {
              const e = new Error('[LoginService] setPersistence falhou (fallback incluso).');
              (e as any).original = err;
              (e as any).fallback = err2;
              this.globalErrorHandler.handleError(e);
            } catch { }
            return of(void 0);
          })
        );
      })
    );
  }

  private resolvePersistence(input: 'local' | 'session' | 'none' | Persistence): Persistence {
    // ✅ em emulador: não insistir em local/session
    if (this.isAuthEmuActive()) return inMemoryPersistence;

    if (typeof input === 'string') {
      switch (input) {
        case 'local':
          return browserLocalPersistence;
        case 'session':
          return browserSessionPersistence;
        case 'none':
          return inMemoryPersistence;
      }
    }
    return input;
  }

  // ---------------------------------------------------------------------------
  // Model helpers
  // ---------------------------------------------------------------------------
  private minimalFromAuth(u: User): IUserDados {
    return {
      uid: u.uid,
      email: u.email ?? '',
      nickname: u.displayName ?? (u.email ? u.email.split('@')[0] : 'Usuário'),
      emailVerified: !!u.emailVerified,
      isSubscriber: false,
      profileCompleted: false,
      role: 'basic' as any,
    } as IUserDados;
  }

  private needsProfileCompletion(u: IUserDados): boolean {
    if (typeof (u as any)?.profileCompleted === 'boolean') return !(u as any).profileCompleted;
    return !u?.nickname || !(u as any)?.gender;
  }

  private syncEmailVerifiedIfNeeded$(
    uid: string,
    nowVerified: boolean,
    userData: IUserDados
  ): Observable<IUserDados> {
    if (!nowVerified || userData.emailVerified === true) return of(userData);

    return this.emailVerificationService.updateEmailVerificationStatus(uid, true).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),
      catchError((e) => {
        try {
          const err = new Error('[LoginService] syncEmailVerified falhou (ignorado).');
          (err as any).original = e;
          (err as any).uid = uid;
          this.globalErrorHandler.handleError(err);
        } catch { }
        // continua o fluxo
        return of(void 0);
      }),
      map(() => {
        const patched = { ...userData, emailVerified: true } as IUserDados;
        this.currentUserStore.set(patched);
        return patched;
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Firestore seeds (evita loop: agora são "one-shot")
  // ---------------------------------------------------------------------------
  private ensureUserDoc$(authUser: User, data: IUserDados): Observable<void> {
    const uid = authUser.uid;
    const ref = this.ctx.run(() => doc(this.firestore, `users/${uid}`));

    // ✅ payload mínimo e estável (evita regravar campos demais)
    const payload: Partial<IUserDados> & Record<string, any> = {
      uid,
      email: data.email ?? authUser.email ?? '',
      nickname: data.nickname ?? authUser.displayName ?? '',
      emailVerified: !!authUser.emailVerified,
      // createdAt só se for a primeira vez? não dá pra condicionar sem ler.
      // Mantemos fora para não "carimbar" toda vez.
    };

    return this.ctx.deferPromise$(() => setDoc(ref, payload, { merge: true })).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),
      catchError((e) => {
        try {
          const err = new Error('[LoginService] ensureUserDoc$ falhou (ignorado).');
          (err as any).uid = uid;
          (err as any).original = e;
          this.globalErrorHandler.handleError(err);
        } catch { }
        return of(void 0);
      }),
      map(() => void 0)
    );
  }

  private patchLastLogin$(uid: string): Observable<void> {
    const ref = this.ctx.run(() => doc(this.firestore, `users/${uid}`));

    return this.ctx.deferPromise$(() =>
      setDoc(ref, { lastLogin: this.ctx.run(() => serverTimestamp()) }, { merge: true })
    ).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),
      catchError((e) => {
        try {
          const err = new Error('[LoginService] patchLastLogin$ falhou (ignorado).');
          (err as any).uid = uid;
          (err as any).original = e;
          this.globalErrorHandler.handleError(err);
        } catch { }
        return of(void 0);
      }),
      map(() => void 0)
    );
  }

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------
  login$(email: string, password: string, rememberMe?: boolean): Observable<LoginResult> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return of({ success: false, code: 'offline', message: 'Sem conexão com a internet.' });
    }

    return iif(
      () => typeof rememberMe === 'boolean',
      this.setSessionPersistence$(rememberMe ? 'local' : 'session'),
      of(void 0)
    ).pipe(
      switchMap(() => defer(() => from(signInWithEmailAndPassword(this.auth, email, password)))),
      timeout({ each: this.NET_TIMEOUT_MS }),

      // 🔁 garante refresh do emailVerified
      switchMap(({ user }) =>
        defer(() => from(user.reload())).pipe(
          timeout({ each: this.NET_TIMEOUT_MS }),
          map(() => user as User)
        )
      ),

      switchMap((refreshed) => {
        if (!refreshed) {
          return of({
            success: false,
            code: 'auth/no-user',
            message: 'Não foi possível autenticar agora.',
          });
        }

        return this.firestoreUserQuery.getUser(refreshed.uid).pipe(
          timeout({ each: this.NET_TIMEOUT_MS }),
          retry({ count: 2, delay: 200 }),
          take(1), // ✅ mata loop de stream vivo aqui

          switchMap((userData) => {
            const base: IUserDados = (userData as IUserDados | null | undefined) ?? this.minimalFromAuth(refreshed);

            const effectiveUser: IUserDados = {
              ...base,
              uid: refreshed.uid,
              email: refreshed.email ?? base.email,
              emailVerified: !!refreshed.emailVerified,
            } as IUserDados;

            // armazena o usuário "como está" imediatamente
            this.currentUserStore.set(effectiveUser);

            // ✅ seed mínimo + lastLogin
            const seed$ = this.ensureUserDoc$(refreshed, effectiveUser).pipe(
              switchMap(() => this.patchLastLogin$(refreshed.uid)),
              map(() => void 0)
            );

            // ✅ tracking só quando estiver “liberado”
            // (reduz muito spam de writes durante login de conta não verificada)
            const canStartTracking = !!refreshed.emailVerified && !this.needsProfileCompletion(effectiveUser);

            if (canStartTracking) {
              this.zone.runOutsideAngular(() => {
                defer(() => Promise.resolve(this.geoloc.autoStartTracking(refreshed.uid)))
                  .pipe(catchError(() => of(void 0)))
                  .subscribe();
              });
            }

            return seed$.pipe(
              switchMap((): Observable<IUserDados> =>
                this.syncEmailVerifiedIfNeeded$(refreshed.uid, !!refreshed.emailVerified, effectiveUser)
              ),
              map((finalUser: IUserDados) => ({
                success: true,
                emailVerified: !!refreshed.emailVerified,
                user: finalUser,
                needsProfileCompletion: this.needsProfileCompletion(finalUser),
              }))
            );
          })
        );
      }),

      catchError((err) => {
        const mapped = this.mapAuthError(err);

        try {
          const e = new Error(mapped.message);
          (e as any).code = mapped.code;
          (e as any).original = err;
          this.globalErrorHandler.handleError(e);
        } catch { }

        return of({ success: false, code: mapped.code, message: mapped.message });
      })
    );
  }

  requestGeolocationOnce$(): Observable<boolean> {
    return defer(() => this.geoloc.requestPermissionOnce()).pipe(
      map((state) => {
        const uid = this.auth.currentUser?.uid;
        if (uid && state === 'granted') {
          this.geoloc.startTracking(uid);
          return true;
        }
        return false;
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Reset / Confirm / Reauth
  // ---------------------------------------------------------------------------
  sendPasswordReset$(email: string): Observable<void> {
    return defer(() => from(sendPasswordResetEmailFn(this.auth, email))).pipe(map(() => void 0));
  }
  sendPasswordResetEmail$(email: string): Observable<void> {
    return this.sendPasswordReset$(email);
  }
  confirmPasswordReset$(oobCode: string, newPassword: string): Observable<void> {
    return defer(() => from(confirmPasswordReset(this.auth, oobCode, newPassword))).pipe(map(() => void 0));
  }
  reauthenticateUser$(password: string): Observable<void> {
    const user = this.auth.currentUser;
    if (!user?.email) return of(void 0);

    const credential = EmailAuthProvider.credential(user.email, password);
    return defer(() => from(reauthenticateWithCredential(user, credential))).pipe(map(() => void 0));
  }

  // ---------------------------------------------------------------------------
  // Wrappers Promise
  // ---------------------------------------------------------------------------
  setSessionPersistence(p: 'local' | 'session' | 'none' | Persistence): Promise<void> {
    return firstValueFrom(this.setSessionPersistence$(p));
  }
  login(email: string, password: string, rememberMe?: boolean): Promise<LoginResult> {
    return firstValueFrom(this.login$(email, password, rememberMe));
  }
  sendPasswordReset(email: string): Promise<void> {
    return firstValueFrom(this.sendPasswordReset$(email));
  }
  sendPasswordResetEmail(email: string): Promise<void> {
    return this.sendPasswordReset(email);
  }
  confirmPasswordReset(oobCode: string, newPassword: string): Promise<void> {
    return firstValueFrom(this.confirmPasswordReset$(oobCode, newPassword));
  }
  reauthenticateUser(password: string): Promise<void> {
    return firstValueFrom(this.reauthenticateUser$(password));
  }

  // ---------------------------------------------------------------------------
  // Erros Auth
  // ---------------------------------------------------------------------------
  private mapAuthError(error: any): { code?: string; message: string } {
    if (error?.name === 'TimeoutError') {
      return { code: 'timeout', message: 'Tempo de resposta excedido. Tente novamente.' };
    }

    const code = error?.code as string | undefined;
    let message = 'Erro ao realizar login. Tente novamente.';

    switch (code) {
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
      case 'auth/invalid-login-credentials':
      case 'auth/INVALID_LOGIN_CREDENTIALS':
      case 'auth/INVALID_PASSWORD':
      case 'auth/EMAIL_NOT_FOUND':
        message = 'E-mail ou senha incorretos.';
        break;

      case 'auth/user-not-found':
        message = 'Usuário não encontrado. Verifique o e-mail inserido.';
        break;

      case 'auth/invalid-email':
        message = 'Formato de e-mail inválido.';
        break;

      case 'auth/user-disabled':
        message = 'Este usuário foi desativado.';
        break;

      case 'auth/too-many-requests':
        message = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
        break;

      case 'auth/network-request-failed': {
        const cfg: any = environment as any;
        const usingAuthEmu = !environment.production && !!cfg?.emulators?.auth?.host && !!cfg?.emulators?.auth?.port;

        if (usingAuthEmu) {
          const { host, port } = cfg.emulators.auth;
          message = `Falha de conexão ao autenticar. Se usa emulador, verifique o Auth Emulator em http://${host}:${port}.`;
        } else {
          message = 'Falha de conexão ao autenticar. Verifique sua internet e tente novamente.';
        }
        break;
      }

      case 'deadline-exceeded':
        message = 'Tempo de resposta excedido. Tente novamente.';
        break;
    }

    return { code, message };
  }
} /* Já tem 421 linhas, considerar refatorar em partes menores ou
buscar realocar métodos para outros serviços mais especializados, mesmo
que tenha que criar novos */
