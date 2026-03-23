// src/app/core/services/autentication/auth/auth.facade.ts
// =============================================================================
// AUTH FACADE
//
// Responsabilidade desta facade:
// - centralizar fluxos de autenticação usados pela UI
// - expor estado reativo de loading
// - encapsular register, verificação de e-mail, social auth e logout
// - devolver resultados estruturados para a camada chamadora decidir UI/rota
//
// NÃO é responsabilidade desta facade:
// - decidir regra de negócio de maioridade
// - hidratar CurrentUserStore manualmente
// - iniciar watchers
// - executar side-effects de navegação automaticamente
//
// Observação:
// - A camada chamadora (component, container, orchestrator ou guard) decide:
//   - feedback visual
//   - navegação
//   - pós-ação
// =============================================================================

import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, finalize, map } from 'rxjs/operators';
import type { UserCredential } from 'firebase/auth';

import { RegisterService } from '../register/register.service';
import {
  EmailVerificationService,
  VerifyEmailResult,
} from '../register/email-verification.service';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { LogoutService } from './logout.service';
import {
  SocialAuthService,
  SocialAuthResult,
} from '../social-auth.service';

export interface RegisterFacadeResult {
  success: boolean;
  credential?: UserCredential;
  needsEmailVerification: boolean;
  message?: string;
  code?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthFacade {
  private readonly loadingSubject = new BehaviorSubject<boolean>(false);

  /**
   * loading$:
   * - permite UI reativa simples
   * - útil para botão, spinner e bloqueio temporário de ações concorrentes
   */
  readonly loading$: Observable<boolean> = this.loadingSubject.asObservable();

  constructor(
    private readonly registerService: RegisterService,
    private readonly emailVerification: EmailVerificationService,
    private readonly logoutService: LogoutService,
    private readonly socialAuthService: SocialAuthService,
  ) {}

  // ===========================================================================
  // Helpers internos
  // ===========================================================================

  private startLoading(): void {
    this.loadingSubject.next(true);
  }

  private stopLoading(): void {
    this.loadingSubject.next(false);
  }

  // ===========================================================================
  // Registro
  // ===========================================================================

  register$(
    user: IUserRegistrationData,
    password: string
  ): Observable<RegisterFacadeResult> {
    this.startLoading();

    return this.registerService.registerUser(user, password).pipe(
      map((credential) => ({
        success: true,
        credential,
        needsEmailVerification: true,
      })),
      catchError((err: any) =>
        of({
          success: false,
          needsEmailVerification: false,
          code: err?.code,
          message: err?.message || 'Não foi possível concluir o registro.',
        })
      ),
      finalize(() => this.stopLoading())
    );
  }

  // ===========================================================================
  // Verificação de e-mail
  // ===========================================================================

  resendVerificationEmail$(): Observable<string> {
    this.startLoading();

    return this.emailVerification.resendVerificationEmail().pipe(
      finalize(() => this.stopLoading())
    );
  }

  handleEmailVerification$(): Observable<VerifyEmailResult> {
    this.startLoading();

    return this.emailVerification.handleEmailVerification().pipe(
      finalize(() => this.stopLoading())
    );
  }

  // ===========================================================================
  // Social auth
  // ===========================================================================

  /**
   * googleLogin$:
   * - executa login social
   * - devolve SocialAuthResult estruturado
   * - não navega
   * - não faz toast
   *
   * A UI decide:
   * - mostrar mensagem
   * - navegar para result.nextRoute
   * - abrir fluxo complementar
   */
  googleLogin$(): Observable<SocialAuthResult> {
    this.startLoading();

    return this.socialAuthService.googleLogin().pipe(
      catchError((err: any) =>
        of({
          success: false,
          outcome: 'error',
          isNewUser: false,
          emailVerified: false,
          user: null,
          nextRoute: null,
          code: err?.code ?? 'auth-facade/social-login-failed',
          message: err?.message ?? 'Não foi possível autenticar com Google agora.',
        } as SocialAuthResult)
      ),
      finalize(() => this.stopLoading())
    );
  }

  // ===========================================================================
  // Logout
  // ===========================================================================

  logout$(): Observable<void> {
    this.startLoading();

    return this.logoutService.logout$().pipe(
      finalize(() => this.stopLoading())
    );
  }

  logoutNow(): void {
    this.logoutService.logout();
  }
}
/*
(1) fonte única,
(2) hidratação / limpeza automática,
(3) gating de listeners realtime,
(4) observabilidade + erro centralizado.

AuthSessionService como dono do UID
authState(this.auth).pipe(shareReplay…) + uid$ com distinctUntilChanged()
é o padrão certo: um stream, replayado, barato, e “sempre igual”.

CurrentUserStoreService como dono do IUserDados
Ter BehaviorSubject<IUserDados | null | undefined> é ótimo porque:

undefined = “ainda não hidratei”
null = “não logado”
objeto = “logado e com perfil carregado”

Restore seguro
restoreFromCache() comparando UID do auth.currentUser?.uid com o UID persistido
é exatamente o tipo de “não confie no storage” que se vê em produção.
Gating na header (LinksInteraction)
O canListen$ com emailVerified === true + fora do fluxo de registro evita exatamente
os 400 (Bad Request) / listeners indevidos antes do usuário estar pronto.
 */
/*
src/app/core/services/autentication/auth/auth-session.service.ts
src/app/core/services/autentication/auth/current-user-store.service.ts
src/app/core/services/autentication/auth/auth-orchestrator.service.ts
src/app/core/services/autentication/auth/auth.facade.ts
src/app/core/services/autentication/auth/logout.service.ts
*/
// Verificar migrações de responsabilidades para o:
// 1 - auth-route-context.service.ts, e;
// 2 - auth-user-document-watch.service.ts, e;
// 3 - auth-session-monitor.service.ts.
