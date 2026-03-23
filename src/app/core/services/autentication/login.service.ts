// src/app/core/services/autentication/login.service.ts
// ===============================================================
// LoginService
//
// Responsabilidade deste service:
// - autenticar via Firebase Auth
// - definir persistência da sessão
// - montar um estado mínimo do usuário autenticado
// - hidratar CurrentUserStoreService de forma leve
//
// NÃO é responsabilidade deste service:
// - seed de sessão
// - watchers
// - presence
// - keepAlive
// - geolocalização
// - pós-login de domínio
//
// Tudo isso continua no AuthOrchestrator / serviços correlatos.
// ===============================================================

import { Injectable } from '@angular/core';
import { Observable, defer, firstValueFrom, of } from 'rxjs';
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

  // ----------------------------------------------------------
  // Ambiente / debug
  // ----------------------------------------------------------

  private isBrowser(): boolean {
    return typeof window !== 'undefined';
  }

  private debugEnabled(): boolean {
    return (
      !environment.production &&
      !!environment.enableDebugTools &&
      this.isBrowser() &&
      (window as any).__DBG_ON__ === true
    );
  }

  private dbg(message: string, extra?: unknown): void {
    if (!this.debugEnabled()) return;

    try {
      (window as any)?.DBG?.(`[LoginService] ${message}`, extra ?? '');
    } catch {
      // noop
    }
  }

  private warn(message: string, extra?: unknown): void {
    if (!this.debugEnabled()) return;

    try {
      (window as any)?.DBG?.(`[LoginService][WARN] ${message}`, extra ?? '');
    } catch {
      // noop
    }
  }

  private safeEmail(email: string | null | undefined): string {
    const e = (email ?? '').trim();
    if (!e) return '';

    const [user, domain] = e.split('@');
    if (!user || !domain) return e;

    return `${user.slice(0, 2)}***@${domain}`;
  }

  private persistenceLabel(p: Persistence): string {
    if (p === browserLocalPersistence) return 'local';
    if (p === browserSessionPersistence) return 'session';
    if (p === inMemoryPersistence) return 'memory';
    return 'custom';
  }

  private reportSilent(
    message: string,
    original: unknown,
    extra?: Record<string, unknown>
  ): void {
    try {
      const e = new Error(message);
      (e as any).silent = true;
      (e as any).skipUserNotification = true;
      (e as any).original = original;
      (e as any).context = 'LoginService';
      (e as any).extra = extra;

      this.globalErrorHandler.handleError(e);
    } catch {
      // noop
    }
  }

  // ---------------------------------------------------------------------------
  // Emulator / persistência
  // ---------------------------------------------------------------------------

  /**
   * Auth Emulator ativo?
   *
   * Mantém a checagem compatível com o seu environment atual:
   * - exige dev
   * - exige useEmulators=true
   * - exige host/port do auth
   */
  private isAuthEmuActive(): boolean {
    const cfg: any = environment as any;

    return (
      !environment.production &&
      cfg?.useEmulators === true &&
      !!cfg?.emulators?.auth?.host &&
      !!cfg?.emulators?.auth?.port
    );
  }

  /**
   * Lê o modo de persistência do Auth Emulator.
   *
   * Deve ficar coerente com:
   * - src/main.ts
   * - src/app/app.module.ts
   *
   * Default:
   * - memory
   *
   * Motivo:
   * - reduz sessão fantasma quando o emulator é resetado.
   */
  private getEmuPersistMode(): EmuPersistMode {
    if (!this.isBrowser()) return 'memory';

    const raw = (localStorage.getItem(this.EMU_AUTH_PERSIST_KEY) || '')
      .trim()
      .toLowerCase();

    return raw === 'session' ? 'session' : 'memory';
  }

  /**
   * Resolve a persistência final.
   *
   * Regras:
   * - Cloud/prod:
   *   - respeita local/session/none
   * - Emulator:
   *   - ignora "local"
   *   - usa a convenção global do projeto:
   *     - session -> browserSessionPersistence
   *     - memory  -> inMemoryPersistence
   */
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
        return inMemoryPersistence;
    }
  }

  /**
   * Define persistência de forma resiliente.
   *
   * Estratégia:
   * - tenta a persistência desejada
   * - se falhar, tenta um fallback
   * - por fim tenta memory
   *
   * Importante:
   * - falha aqui não deve derrubar a UX inteira
   * - o erro é observado pelo GlobalErrorHandler
   */
  setSessionPersistence$(
    modeOrPersistence: SessionMode | Persistence
  ): Observable<void> {
    const requested = this.resolvePersistence(modeOrPersistence);

    const trySet$ = (p: Persistence) =>
      this.ctx.deferPromise$(() => setPersistence(this.auth, p)).pipe(
        timeout({ each: this.NET_TIMEOUT_MS }),
        map(() => void 0)
      );

    const fallback1 =
      requested === browserLocalPersistence
        ? browserSessionPersistence
        : inMemoryPersistence;

    this.dbg('setSessionPersistence:start', {
      usingEmu: this.isAuthEmuActive(),
      requested: this.persistenceLabel(requested),
      fallback1: this.persistenceLabel(fallback1),
    });

    return trySet$(requested).pipe(
      map(() => {
        this.dbg('setSessionPersistence:ok', {
          resolved: this.persistenceLabel(requested),
        });
        return void 0;
      }),

      catchError((err1) => {
        this.warn('setSessionPersistence:fallback1', {
          requested: this.persistenceLabel(requested),
          fallback1: this.persistenceLabel(fallback1),
          err1,
        });

        return trySet$(fallback1).pipe(
          map(() => {
            this.dbg('setSessionPersistence:ok:fallback1', {
              resolved: this.persistenceLabel(fallback1),
            });
            return void 0;
          }),

          catchError((err2) => {
            this.warn('setSessionPersistence:fallback2', {
              requested: this.persistenceLabel(requested),
              fallback1: this.persistenceLabel(fallback1),
              fallback2: this.persistenceLabel(inMemoryPersistence),
              err2,
            });

            return trySet$(inMemoryPersistence).pipe(
              map(() => {
                this.dbg('setSessionPersistence:ok:fallback2', {
                  resolved: this.persistenceLabel(inMemoryPersistence),
                });
                return void 0;
              }),

              catchError((err3) => {
                this.reportSilent(
                  '[LoginService] setPersistence falhou em todas as tentativas.',
                  err3,
                  {
                    requested: this.persistenceLabel(requested),
                    fallback1: this.persistenceLabel(fallback1),
                    fallback2: this.persistenceLabel(inMemoryPersistence),
                    err1,
                    err2,
                    err3,
                  }
                );

                // Não bloqueia o fluxo inteiro.
                return of(void 0);
              })
            );
          })
        );
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Model helpers
  // ---------------------------------------------------------------------------

  /**
   * Estado mínimo derivado do Firebase Auth.
   *
   * Usado como fallback quando:
   * - users/{uid} ainda não chegou
   * - leitura do Firestore falha
   * - o doc ainda está propagando
   */
  private minimalFromAuth(user: User): IUserDados {
    return {
      uid: user.uid,
      email: user.email ?? '',
      nickname: user.displayName ?? (user.email ? user.email.split('@')[0] : 'Usuário'),
      emailVerified: !!user.emailVerified,
      isSubscriber: false,
      profileCompleted: false,
      role: 'basic' as any,
    } as IUserDados;
  }

  /**
   * Regras mínimas de completude.
   *
   * Mantém o comportamento atual:
   * - se profileCompleted vier explícito, ele manda
   * - senão, inferimos por nickname/gender
   */
  private needsProfileCompletion(user: IUserDados): boolean {
    if (typeof (user as any)?.profileCompleted === 'boolean') {
      return !(user as any).profileCompleted;
    }

    return !user?.nickname || !(user as any)?.gender;
  }

  /**
   * Monta o usuário efetivo combinando:
   * - snapshot do Firestore (quando disponível)
   * - dados do Auth como fonte mais confiável para uid/email/emailVerified
   */
  private buildEffectiveUser(
    authUser: User,
    firestoreUser: IUserDados | null | undefined
  ): IUserDados {
    const base = firestoreUser ?? this.minimalFromAuth(authUser);

    return {
      ...base,
      uid: authUser.uid,
      email: authUser.email ?? base.email,
      emailVerified: !!authUser.emailVerified,
    } as IUserDados;
  }

  /**
   * Faz um snapshot único do users/{uid} após login.
   *
   * Importante:
   * - não abre listener realtime aqui
   * - falha de Firestore NÃO derruba o login
   * - se o doc ainda não existir no primeiro instante, retry curto ajuda
   */
private loadEffectiveUserAfterLogin$(authUser: User): Observable<LoginResult> {
  if (!authUser?.uid) {
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
    catchError((err) => {
      this.reportSilent(
        '[LoginService] Falha ao ler users/{uid} após login. Seguindo com fallback do Auth.',
        err,
        { uid: authUser.uid }
      );

      return of(null);
    }),
    map((firestoreUser) => {
      const effectiveUser = this.buildEffectiveUser(
        authUser,
        firestoreUser as IUserDados | null | undefined
      );

      return {
        success: true,
        emailVerified: !!authUser.emailVerified,
        user: effectiveUser,
        needsProfileCompletion: this.needsProfileCompletion(effectiveUser),
      } as LoginResult;
    })
  );
}

  // --------------------------------------------------------------------
  // Login
  // --------------------------------------------------------------------

  /**
   * Login principal.
   *
   * Fluxo:
   * 1) define persistência
   * 2) autentica no Firebase Auth
   * 3) tenta snapshot único do users/{uid}
   * 4) se Firestore falhar, usa fallback do Auth
   *
   * Observação:
   * - não chamamos user.reload() logo após signIn
   * - o objeto retornado pelo signIn já é suficiente para este momento
   * - isso reduz ruído e round-trips desnecessários
   */
  login$(
    email: string,
    password: string,
    rememberMe?: boolean
  ): Observable<LoginResult> {
    const safeEmail = (email ?? '').trim();
    const safePassword = password ?? '';

    if (!safeEmail || !safePassword) {
      return of({
        success: false,
        code: 'validation/invalid-input',
        message: 'Informe e-mail e senha.',
      });
    }

    /**
     * Se estiver em emulator local, navigator.onLine=false não é motivo suficiente
     * para abortar, porque localhost ainda pode estar acessível.
     *
     * Já em cloud, offline real deve abortar cedo.
     */
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

    /**
     * Cloud:
     * - rememberMe=true  -> local
     * - rememberMe=false -> session
     * - undefined        -> local
     *
     * Emulator:
     * - respeitamos a convenção global (memory/session)
     * - local não é usado
     */
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
      rememberMe: typeof rememberMe === 'boolean' ? rememberMe : 'default',
      requestedMode,
      usingEmu: this.isAuthEmuActive(),
      emuPersistMode: this.isAuthEmuActive() ? this.getEmuPersistMode() : 'cloud',
    });

    return this.setSessionPersistence$(requestedMode).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),

      switchMap(() =>
        this.ctx.deferPromise$(() =>
          signInWithEmailAndPassword(this.auth, safeEmail, safePassword)
        ).pipe(timeout({ each: this.NET_TIMEOUT_MS }))
      ),

      switchMap(({ user }) => {
        this.dbg('login:signIn:ok', {
          uid: user?.uid ?? null,
          emailVerified: !!user?.emailVerified,
        });

        return this.loadEffectiveUserAfterLogin$(user);
      }),

      catchError((err) => {
        const mapped = this.mapAuthError(err);

        this.reportSilent(mapped.message, err, {
          code: mapped.code,
          service: 'LoginService.login$',
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
  // Reset / Confirm / Reauth
  // ---------------------------------------------------------------------------

  sendPasswordReset$(email: string): Observable<void> {
    return this.ctx.deferPromise$(() =>
      sendPasswordResetEmailFn(this.auth, (email ?? '').trim())
    ).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),
      map(() => void 0)
    );
  }

  sendPasswordResetEmail$(email: string): Observable<void> {
    return this.sendPasswordReset$(email);
  }

  confirmPasswordReset$(
    oobCode: string,
    newPassword: string
  ): Observable<void> {
    return this.ctx.deferPromise$(() =>
      confirmPasswordReset(this.auth, oobCode, newPassword)
    ).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),
      map(() => void 0)
    );
  }

  reauthenticateUser$(password: string): Observable<void> {
    const user = this.auth.currentUser;

    if (!user?.email) {
      return of(void 0);
    }

    const credential = EmailAuthProvider.credential(user.email, password);

    return this.ctx.deferPromise$(() =>
      reauthenticateWithCredential(user, credential)
    ).pipe(
      timeout({ each: this.NET_TIMEOUT_MS }),
      map(() => void 0)
    );
  }

  // ---------------------------------------------------------------
  // Wrappers Promise
  // ---------------------------------------------------------------

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

  // -------------------------------------------------------------
  // Mapeamento de erros Auth
  // -------------------------------------------------------------

  /**
   * Converte erros técnicos em mensagem de UX.
   *
   * Observação:
   * - mantive "user-not-found" separado, porque seu fluxo atual já usa isso
   * - se quiser endurecer privacidade depois, dá para unificar com credenciais inválidas
   */
  private mapAuthError(
    error: any
  ): { code?: string; message: string } {
    if (error?.name === 'TimeoutError') {
      return {
        code: 'timeout',
        message: 'Tempo de resposta excedido. Tente novamente.',
      };
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
        const usingAuthEmu =
          !environment.production &&
          cfg?.useEmulators === true &&
          !!cfg?.emulators?.auth?.host &&
          !!cfg?.emulators?.auth?.port;

        if (usingAuthEmu) {
          const { host, port } = cfg.emulators.auth;
          message =
            `Falha de conexão ao autenticar. ` +
            `Se você está em dev-emu, verifique o Auth Emulator em http://${host}:${port}.`;
        } else {
          message =
            'Falha de conexão ao autenticar. Verifique sua internet e tente novamente.';
        }
        break;
      }

      case 'deadline-exceeded':
        message = 'Tempo de resposta excedido. Tente novamente.';
        break;
    }

    return { code, message };
  }
} // fim do login.service.ts, que tá com 718 linhas
// Verificar migrações de responsabilidades para:
// 1 - auth-route-context.service.ts
// 2 - auth-user-document-watch.service.ts
// 3 - auth-session-monitor.service.ts
// 4 - ou qualquer função daqui pra service mais especifico
