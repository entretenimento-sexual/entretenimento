// src/app/core/services/autentication/login.service.ts
// LoginService: autenticação + construção do estado mínimo (SEM side-effects de sessão)
// Side-effects (seed/lastLogin/geoloc/presence/watchers/keepAlive) ficam no AuthOrchestrator.
import { Injectable } from '@angular/core';
import { Observable, of, from, defer, firstValueFrom } from 'rxjs';
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

import { IUserDados } from '../../interfaces/iuser-dados';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { FirestoreUserQueryService } from '../data-handling/firestore-user-query.service';
import { environment } from 'src/environments/environment';
import { CurrentUserStoreService } from './auth/current-user-store.service';

import { FirestoreContextService } from '@core/services/data-handling/firestore/core/firestore-context.service';

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
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly auth: Auth,
    private readonly ctx: FirestoreContextService
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
    const requested = this.resolvePersistence(modeOrPersistence);

    const trySet$ = (p: Persistence) =>
      this.ctx.deferPromise$(() => setPersistence(this.auth, p)).pipe(map(() => void 0));

    const fallback1 =
      requested === browserLocalPersistence ? browserSessionPersistence : inMemoryPersistence;

    return trySet$(requested).pipe(
      catchError(() =>
        trySet$(fallback1).pipe(
          catchError((err2) =>
            trySet$(inMemoryPersistence).pipe(
              catchError((err3) => {
                // Observabilidade apenas (não derruba UX)
                try {
                  const e = new Error('[LoginService] setPersistence falhou (todos fallbacks falharam).');
                  (e as any).requested = requested;
                  (e as any).fallback1 = fallback1;
                  (e as any).fallback2 = inMemoryPersistence;
                  (e as any).fallbackError = err2;
                  (e as any).finalError = err3;
                  (e as any).silent = true;
                  (e as any).skipUserNotification = true;
                  this.globalErrorHandler.handleError(e);
                } catch { }
                return of(void 0);
              })
            )
          )
        )
      )
    );
  }

  private resolvePersistence(input: 'local' | 'session' | 'none' | Persistence): Persistence {
    if (typeof input !== 'string') return input;

    // ✅ emulador: evita "local" para reduzir estado fantasma
    if (this.isAuthEmuActive()) {
      if (input === 'none') return inMemoryPersistence;
      return browserSessionPersistence;
    }

    switch (input) {
      case 'local': return browserLocalPersistence;
      case 'session': return browserSessionPersistence;
      case 'none': return inMemoryPersistence;
    }
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

  // ---------------------------------------------------------------------------
  // Login (SEM side-effects de seed/geo; isso roda no AuthOrchestrator)
  // ---------------------------------------------------------------------------
  login$(email: string, password: string, rememberMe?: boolean): Observable<LoginResult> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return of({ success: false, code: 'offline', message: 'Sem conexão com a internet.' });
    }

    const mode: 'local' | 'session' =
      (typeof rememberMe === 'boolean')
        ? (rememberMe ? 'local' : 'session')
        : (this.isAuthEmuActive() ? 'session' : 'local');

    return defer(() => this.setSessionPersistence$(mode)).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),

      switchMap(() => defer(() => from(signInWithEmailAndPassword(this.auth, email, password)))),
      timeout({ each: this.NET_TIMEOUT_MS }),

      switchMap(({ user }) =>
        defer(() => from(user.reload())).pipe(
          timeout({ each: this.NET_TIMEOUT_MS }),
          map(() => user as User)
        )
      ),

      switchMap((refreshed) => {
        if (!refreshed?.uid) {
          return of({ success: false, code: 'auth/no-user', message: 'Não foi possível autenticar agora.' });
        }

        // ✅ one-shot/snapshot determinístico (evita listener realtime no login)
        return this.firestoreUserQuery.getUser$(refreshed.uid).pipe(
          timeout({ each: this.NET_TIMEOUT_MS }),
          retry({ count: 2, delay: 200 }),
          take(1),

          // ✅ aqui era o seu TS2345: com map retornamos LoginResult (não void)
          map((userData) => {
            const base = (userData as IUserDados | null | undefined) ?? this.minimalFromAuth(refreshed);

            const effectiveUser: IUserDados = {
              ...base,
              uid: refreshed.uid,
              email: refreshed.email ?? base.email,
              emailVerified: !!refreshed.emailVerified,
            } as IUserDados;

            // Estado do app (fonte: CurrentUserStore)
            this.currentUserStore.set(effectiveUser);

            return {
              success: true,
              emailVerified: !!refreshed.emailVerified,
              user: effectiveUser,
              needsProfileCompletion: this.needsProfileCompletion(effectiveUser),
            } as LoginResult;
          })
        );
      }),

      catchError((err) => {
        const mapped = this.mapAuthError(err);

        // Observabilidade sem duplicar toast (o componente já mostra)
        try {
          const e = new Error(mapped.message);
          (e as any).code = mapped.code;
          (e as any).original = err;
          (e as any).skipUserNotification = true;
          (e as any).context = 'LoginService.login$';
          this.globalErrorHandler.handleError(e);
        } catch { }

        return of({ success: false, code: mapped.code, message: mapped.message });
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
}
