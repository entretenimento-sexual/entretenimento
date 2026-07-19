// src/app/core/services/autentication/login.service.ts
// -----------------------------------------------------------------------------
// LOGIN SERVICE
// -----------------------------------------------------------------------------
// Responsabilidades:
// - autenticar por e-mail/senha;
// - definir persistência da sessão;
// - resolver um snapshot leve do perfil após o Auth;
// - executar recuperação, confirmação de senha e reautenticação.
//
// Não executa onboarding, presença, geolocalização ou navegação pós-login.
// Todos os métodos públicos anteriores foram preservados.
// -----------------------------------------------------------------------------
import { Injectable } from '@angular/core';
import {
  Observable,
  defer,
  firstValueFrom,
  of,
  throwError,
} from 'rxjs';
import {
  catchError,
  map,
  retry,
  switchMap,
  take,
  timeout,
} from 'rxjs/operators';

import {
  browserLocalPersistence,
  browserSessionPersistence,
  confirmPasswordReset,
  EmailAuthProvider,
  inMemoryPersistence,
  reauthenticateWithCredential,
  sendPasswordResetEmail as sendPasswordResetEmailFn,
  setPersistence,
  signInWithEmailAndPassword,
  type Persistence,
  type User,
} from 'firebase/auth';
import { Auth } from '@angular/fire/auth';

import { IUserDados } from '../../interfaces/iuser-dados';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { FirestoreUserQueryService } from '../data-handling/firestore-user-query.service';
import { environment } from 'src/environments/environment';
import { FirestoreContextService } from '@core/services/data-handling/firestore/core/firestore-context.service';

export interface LoginResult {
  success: boolean;
  emailVerified?: boolean;
  user?: IUserDados;
  code?: string;
  message?: string;
  needsProfileCompletion?: boolean;
  profileResolution?: 'resolved' | 'unknown';
}

type SessionMode = 'local' | 'session' | 'none';
type EmuPersistMode = 'memory' | 'session';

@Injectable({ providedIn: 'root' })
export class LoginService {
  private readonly NET_TIMEOUT_MS = 12_000;
  private readonly EMU_AUTH_PERSIST_KEY = '__EMU_AUTH_PERSIST__';

  constructor(
    private readonly firestoreUserQuery: FirestoreUserQueryService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly auth: Auth,
    private readonly ctx: FirestoreContextService
  ) {}

  // ---------------------------------------------------------------------------
  // Ambiente / debug
  // ---------------------------------------------------------------------------

  private isBrowser(): boolean {
    return typeof window !== 'undefined';
  }

  private debugEnabled(): boolean {
    return (
      !environment.production &&
      environment.enableDebugTools === true &&
      this.isBrowser() &&
      (window as Window & { __DBG_ON__?: boolean }).__DBG_ON__ === true
    );
  }

  private dbg(message: string, extra?: unknown): void {
    if (!this.debugEnabled()) return;

    try {
      const debugWindow = window as Window & {
        DBG?: (message: string, extra?: unknown) => void;
      };
      debugWindow.DBG?.(`[LoginService] ${message}`, extra ?? '');
    } catch {
      // Debug nunca interfere na autenticação.
    }
  }

  private warn(message: string, extra?: unknown): void {
    if (!this.debugEnabled()) return;

    try {
      const debugWindow = window as Window & {
        DBG?: (message: string, extra?: unknown) => void;
      };
      debugWindow.DBG?.(`[LoginService][WARN] ${message}`, extra ?? '');
    } catch {
      // Debug nunca interfere na autenticação.
    }
  }

  private safeEmail(email: string | null | undefined): string {
    const normalized = String(email ?? '').trim();
    if (!normalized) return '';

    const [localPart, domain] = normalized.split('@');
    if (!localPart || !domain) return '***';
    return `${localPart.slice(0, 2)}***@${domain}`;
  }

  private reportSilent(
    message: string,
    original: unknown,
    extra?: Record<string, unknown>
  ): void {
    try {
      const error = new Error(message) as Error & {
        silent?: boolean;
        skipUserNotification?: boolean;
        original?: unknown;
        context?: unknown;
      };
      error.silent = true;
      error.skipUserNotification = true;
      error.original = original;
      error.context = { scope: 'LoginService', ...(extra ?? {}) };
      this.globalErrorHandler.handleError(error);
    } catch {
      // Diagnóstico secundário não altera o resultado principal.
    }
  }

  // ---------------------------------------------------------------------------
  // Persistência
  // ---------------------------------------------------------------------------

  private isAuthEmuActive(): boolean {
    const config = environment as typeof environment & {
      useEmulators?: boolean;
      emulators?: { auth?: { host?: string; port?: number } };
    };

    return (
      !environment.production &&
      config.useEmulators === true &&
      !!config.emulators?.auth?.host &&
      !!config.emulators?.auth?.port
    );
  }

  private getEmuPersistMode(): EmuPersistMode {
    if (!this.isBrowser()) return 'session';

    const raw = String(
      localStorage.getItem(this.EMU_AUTH_PERSIST_KEY) ?? ''
    )
      .trim()
      .toLowerCase();

    return raw === 'memory' ? 'memory' : 'session';
  }

  private resolvePersistence(
    input: SessionMode | Persistence
  ): Persistence {
    if (typeof input !== 'string') return input;

    if (this.isAuthEmuActive()) {
      return this.getEmuPersistMode() === 'session'
        ? browserSessionPersistence
        : inMemoryPersistence;
    }

    switch (input) {
      case 'local':
        return browserLocalPersistence;
      case 'session':
        return browserSessionPersistence;
      case 'none':
      default:
        return inMemoryPersistence;
    }
  }

  private persistenceLabel(persistence: Persistence): string {
    if (persistence === browserLocalPersistence) return 'local';
    if (persistence === browserSessionPersistence) return 'session';
    if (persistence === inMemoryPersistence) return 'memory';
    return 'custom';
  }

  setSessionPersistence$(
    modeOrPersistence: SessionMode | Persistence
  ): Observable<void> {
    const requested = this.resolvePersistence(modeOrPersistence);
    const fallback =
      requested === browserLocalPersistence
        ? browserSessionPersistence
        : inMemoryPersistence;

    const trySet$ = (persistence: Persistence) =>
      this.ctx
        .deferPromise$(() => setPersistence(this.auth, persistence))
        .pipe(
          timeout({ each: this.NET_TIMEOUT_MS }),
          map(() => void 0)
        );

    this.dbg('setSessionPersistence:start', {
      requested: this.persistenceLabel(requested),
      fallback: this.persistenceLabel(fallback),
      usingEmulator: this.isAuthEmuActive(),
    });

    return trySet$(requested).pipe(
      catchError((firstError: unknown) => {
        this.warn('setSessionPersistence:fallback', firstError);

        return trySet$(fallback).pipe(
          catchError((secondError: unknown) => {
            if (fallback === inMemoryPersistence) {
              this.reportSilent(
                'Não foi possível definir a persistência da sessão.',
                secondError,
                { operation: 'setSessionPersistence$', firstError }
              );
              return of(void 0);
            }

            return trySet$(inMemoryPersistence).pipe(
              catchError((thirdError: unknown) => {
                this.reportSilent(
                  'Não foi possível definir a persistência da sessão.',
                  thirdError,
                  {
                    operation: 'setSessionPersistence$',
                    firstError,
                    secondError,
                  }
                );
                return of(void 0);
              })
            );
          })
        );
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Resolução leve do perfil
  // ---------------------------------------------------------------------------

  private minimalFromAuth(user: User): IUserDados {
    return {
      uid: user.uid,
      email: user.email ?? '',
      nickname:
        user.displayName ??
        (user.email ? user.email.split('@')[0] : 'Usuário'),
      emailVerified: user.emailVerified === true,
      isSubscriber: false,
      profileCompleted: undefined,
      role: 'basic' as IUserDados['role'],
    } as IUserDados;
  }

  private needsProfileCompletion(user: IUserDados): boolean {
    if (typeof user.profileCompleted === 'boolean') {
      return !user.profileCompleted;
    }

    return !user.nickname || !user.gender;
  }

  private buildEffectiveUser(
    authUser: User,
    firestoreUser: IUserDados | null | undefined
  ): IUserDados {
    const base = firestoreUser ?? this.minimalFromAuth(authUser);

    return {
      ...base,
      uid: authUser.uid,
      email: authUser.email ?? base.email,
      emailVerified: authUser.emailVerified === true,
    } as IUserDados;
  }

  private loadEffectiveUserAfterLogin$(
    authUser: User
  ): Observable<LoginResult> {
    if (!authUser.uid) {
      return of({
        success: false,
        code: 'auth/no-user',
        message: 'Não foi possível autenticar agora.',
      });
    }

    return this.firestoreUserQuery.getUser$(authUser.uid).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),
      retry({ count: 2, delay: 200 }),
      take(1),
      catchError((error: unknown) => {
        this.reportSilent(
          'Falha ao carregar o perfil após o login.',
          error,
          { operation: 'loadEffectiveUserAfterLogin$', uid: authUser.uid }
        );
        return of(undefined);
      }),
      map((firestoreUser) => {
        const effectiveUser = this.buildEffectiveUser(
          authUser,
          firestoreUser as IUserDados | null | undefined
        );
        const profileResolution: 'resolved' | 'unknown' =
          firestoreUser === undefined ? 'unknown' : 'resolved';

        return {
          success: true,
          emailVerified: authUser.emailVerified === true,
          user: effectiveUser,
          profileResolution,
          needsProfileCompletion:
            profileResolution === 'resolved'
              ? this.needsProfileCompletion(effectiveUser)
              : undefined,
        };
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------

  login$(
    email: string,
    password: string,
    rememberMe?: boolean
  ): Observable<LoginResult> {
    const safeEmail = String(email ?? '').trim().toLowerCase();
    const safePassword = String(password ?? '');

    if (!safeEmail || !safePassword) {
      return of({
        success: false,
        code: 'validation/invalid-input',
        message: 'Informe e-mail e senha.',
      });
    }

    if (
      !this.isAuthEmuActive() &&
      typeof navigator !== 'undefined' &&
      navigator.onLine === false
    ) {
      return of({
        success: false,
        code: 'offline',
        message: 'Sem conexão com a internet.',
      });
    }

    const requestedMode: SessionMode =
      typeof rememberMe === 'boolean'
        ? rememberMe
          ? 'local'
          : 'session'
        : this.isAuthEmuActive()
          ? this.getEmuPersistMode() === 'session'
            ? 'session'
            : 'none'
          : 'local';

    this.dbg('login:start', {
      email: this.safeEmail(safeEmail),
      requestedMode,
      usingEmulator: this.isAuthEmuActive(),
    });

    return this.setSessionPersistence$(requestedMode).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),
      switchMap(() =>
        this.ctx
          .deferPromise$(() =>
            signInWithEmailAndPassword(
              this.auth,
              safeEmail,
              safePassword
            )
          )
          .pipe(timeout({ each: this.NET_TIMEOUT_MS }))
      ),
      switchMap(({ user }) => this.loadEffectiveUserAfterLogin$(user)),
      catchError((error: unknown) => {
        const mapped = this.mapAuthError(error);
        this.reportSilent(mapped.message, error, {
          operation: 'login$',
          code: mapped.code,
          email: this.safeEmail(safeEmail),
        });

        return of({
          success: false,
          code: mapped.code,
          message: mapped.message,
        });
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Recuperação, confirmação e reautenticação
  // ---------------------------------------------------------------------------

  sendPasswordReset$(email: string): Observable<void> {
    const safeEmail = String(email ?? '').trim().toLowerCase();

    if (!this.isValidEmail(safeEmail)) {
      return this.failClosed$(
        'Informe um e-mail válido.',
        'validation/invalid-email',
        'sendPasswordReset$'
      );
    }

    return this.ctx
      .deferPromise$(() =>
        sendPasswordResetEmailFn(this.auth, safeEmail)
      )
      .pipe(
        timeout({ each: this.NET_TIMEOUT_MS }),
        map(() => void 0),
        catchError((error: unknown) =>
          this.reportAndRethrow$(error, 'sendPasswordReset$', {
            email: this.safeEmail(safeEmail),
          })
        )
      );
  }

  sendPasswordResetEmail$(email: string): Observable<void> {
    return this.sendPasswordReset$(email);
  }

  confirmPasswordReset$(
    oobCode: string,
    newPassword: string
  ): Observable<void> {
    const safeCode = String(oobCode ?? '').trim();
    const safePassword = String(newPassword ?? '');

    if (!safeCode) {
      return this.failClosed$(
        'O link de redefinição é inválido ou está incompleto.',
        'validation/invalid-oob-code',
        'confirmPasswordReset$'
      );
    }

    if (safePassword.length < 8) {
      return this.failClosed$(
        'A nova senha deve ter pelo menos 8 caracteres.',
        'validation/weak-password',
        'confirmPasswordReset$'
      );
    }

    return this.ctx
      .deferPromise$(() =>
        confirmPasswordReset(this.auth, safeCode, safePassword)
      )
      .pipe(
        timeout({ each: this.NET_TIMEOUT_MS }),
        map(() => void 0),
        catchError((error: unknown) =>
          this.reportAndRethrow$(error, 'confirmPasswordReset$')
        )
      );
  }

  reauthenticateUser$(password: string): Observable<void> {
    const user = this.auth.currentUser;
    const safePassword = String(password ?? '');

    if (!user?.email) {
      return this.failClosed$(
        'Não foi possível confirmar uma conta com senha nesta sessão.',
        'auth/password-provider-unavailable',
        'reauthenticateUser$'
      );
    }

    if (!safePassword) {
      return this.failClosed$(
        'Informe sua senha para confirmar a identidade.',
        'validation/password-required',
        'reauthenticateUser$'
      );
    }

    const credential = EmailAuthProvider.credential(
      user.email,
      safePassword
    );

    return this.ctx
      .deferPromise$(() =>
        reauthenticateWithCredential(user, credential)
      )
      .pipe(
        timeout({ each: this.NET_TIMEOUT_MS }),
        map(() => void 0),
        catchError((error: unknown) =>
          this.reportAndRethrow$(error, 'reauthenticateUser$', {
            uid: user.uid,
          })
        )
      );
  }

  // ---------------------------------------------------------------------------
  // Wrappers Promise preservados
  // ---------------------------------------------------------------------------

  setSessionPersistence(
    persistence: SessionMode | Persistence
  ): Promise<void> {
    return firstValueFrom(this.setSessionPersistence$(persistence));
  }

  login(
    email: string,
    password: string,
    rememberMe?: boolean
  ): Promise<LoginResult> {
    return firstValueFrom(this.login$(email, password, rememberMe));
  }

  sendPasswordReset(email: string): Promise<void> {
    return firstValueFrom(this.sendPasswordReset$(email));
  }

  sendPasswordResetEmail(email: string): Promise<void> {
    return this.sendPasswordReset(email);
  }

  confirmPasswordReset(
    oobCode: string,
    newPassword: string
  ): Promise<void> {
    return firstValueFrom(this.confirmPasswordReset$(oobCode, newPassword));
  }

  reauthenticateUser(password: string): Promise<void> {
    return firstValueFrom(this.reauthenticateUser$(password));
  }

  // ---------------------------------------------------------------------------
  // Erros e validação
  // ---------------------------------------------------------------------------

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  private failClosed$<T>(
    message: string,
    code: string,
    operation: string
  ): Observable<T> {
    const error = new Error(message) as Error & {
      code?: string;
      skipUserNotification?: boolean;
    };
    error.code = code;
    error.skipUserNotification = true;
    this.reportSilent(message, error, { operation, code });
    return throwError(() => error);
  }

  private reportAndRethrow$<T>(
    error: unknown,
    operation: string,
    extra?: Record<string, unknown>
  ): Observable<T> {
    this.reportSilent(
      `Falha em ${operation}.`,
      error,
      { operation, ...(extra ?? {}) }
    );
    return throwError(() => error);
  }

  private mapAuthError(
    error: unknown
  ): { code?: string; message: string } {
    const source = error as {
      name?: unknown;
      code?: unknown;
    } | null;

    if (source?.name === 'TimeoutError') {
      return {
        code: 'timeout',
        message: 'Tempo de resposta excedido. Tente novamente.',
      };
    }

    const code = String(source?.code ?? '') || undefined;
    let message = 'Erro ao realizar login. Tente novamente.';

    switch (code) {
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
      case 'auth/invalid-login-credentials':
      case 'auth/INVALID_LOGIN_CREDENTIALS':
      case 'auth/INVALID_PASSWORD':
      case 'auth/EMAIL_NOT_FOUND':
      case 'auth/user-not-found':
        message = 'E-mail ou senha incorretos.';
        break;
      case 'auth/invalid-email':
        message = 'Formato de e-mail inválido.';
        break;
      case 'auth/user-disabled':
        message = 'Esta conta está desativada.';
        break;
      case 'auth/too-many-requests':
        message = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
        break;
      case 'auth/network-request-failed':
        message = this.isAuthEmuActive()
          ? 'Falha ao acessar o Auth Emulator. Verifique os emuladores locais.'
          : 'Falha de conexão. Verifique sua internet e tente novamente.';
        break;
      case 'deadline-exceeded':
        message = 'Tempo de resposta excedido. Tente novamente.';
        break;
    }

    return { code, message };
  }
}
