// src/app/authentication/auth-verification-handler/auth-verification-handler.component.ts
import { Component, OnInit, OnDestroy, NgZone } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { EmailVerificationService, VerifyEmailResult } from 'src/app/core/services/autentication/register/email-verification.service';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { LoginService } from 'src/app/core/services/autentication/login.service';
import { FirestoreService } from 'src/app/core/services/data-handling/firestore.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

import { EmailInputModalComponent } from 'src/app/authentication/email-input-modal/email-input-modal.component';
import { EmailInputModalService } from 'src/app/core/services/autentication/email-input-modal.service';

import { Subject, firstValueFrom } from 'rxjs';
import { take, takeUntil, switchMap, tap } from 'rxjs/operators';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

@Component({
  selector: 'app-auth-verification-handler',
  templateUrl: './auth-verification-handler.component.html',
  styleUrls: ['./auth-verification-handler.component.css'],
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, EmailInputModalComponent]
})
export class AuthVerificationHandlerComponent implements OnInit, OnDestroy {
  // estado geral
  public isLoading = true;
  public mode: 'verifyEmail' | 'resetPassword' | '' = '';
  public oobCode = '';
  public message = '';

  // flags de UI específicas de verificação de e-mail
  public verifyOk = false;
  public showResendVerifyCTA = false;   // botão "Reenviar e-mail de verificação"
  public showGoToLoginCTA = false;      // CTA "Ir para login" quando não há usuário logado

  // reset de senha
  public newPassword = '';
  public confirmPassword = '';
  public showPassword = false;
  public showConfirmPassword = false;
  public shouldShowRecoveryLink = false;  // link para reenvio de recuperação se der erro

  // (resto do formulário opcional/antigo – mantido)
  public showSubscriptionOptions = false;
  public gender = '';
  public orientation = '';
  public selectedEstado = '';
  public selectedMunicipio = '';
  public estados: any[] = [];
  public municipios: any[] = [];
  public selectedFile: File | null = null;
  public isUploading = false;
  public progressValue = 0;
  public uploadMessage = '';
  public formErrors: { [key: string]: string } = {
    gender: '',
    orientation: '',
    selectedFile: '',
    estado: '',
    municipio: '',
  };

  private ngUnsubscribe: Subject<void> = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private ngZone: NgZone,

    private emailVerificationService: EmailVerificationService,
    private loginService: LoginService,
    private firestoreService: FirestoreService,
    private firestoreUserQuery: FirestoreUserQueryService,
    private globalErrorHandlerService: GlobalErrorHandlerService,
    private authService: AuthService,
    private emailInputModalService: EmailInputModalService   // ✅ injeta o service do modal
  ) { }

  ngOnInit(): void {
    this.route.queryParams
      .pipe(takeUntil(this.ngUnsubscribe))
      .subscribe(params => {
        this.mode = (params['mode'] || '') as any;
        this.oobCode = params['oobCode'] || '';

        if (!this.oobCode && this.mode === 'resetPassword') {
          // Para reset de senha, o Firebase exige o oobCode também
          this.message = 'Código inválido.';
          this.isLoading = false;
          return;
        }

        if (this.mode === 'verifyEmail') {
          this.processVerifyEmail();
        } else if (this.mode === 'resetPassword') {
          this.isLoading = false; // apenas exibe o form de redefinição
        } else {
          this.message = 'Ação desconhecida.';
          this.isLoading = false;
        }
      });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  // === VERIFICAÇÃO DE E-MAIL ===
  private processVerifyEmail(): void {
    this.isLoading = true;
    // Usa o handler “rico” do service (retorna ok + reason + firestoreUpdated)
    this.emailVerificationService
      .handleEmailVerification()
      .pipe(take(1), takeUntil(this.ngUnsubscribe))
      .subscribe({
        next: (res: VerifyEmailResult) => {
          this.isLoading = false;

          if (res.ok) {
            this.verifyOk = true;

            if (res.reason === 'not-logged-in') {
              // Verificado, mas sem sessão — peça login
              this.message = 'Seu e-mail foi verificado. Faça login para continuar.';
              this.showGoToLoginCTA = true;
              this.showResendVerifyCTA = false;
              return;
            }

            // Sessão presente (ou Firestore sincronizado)
            if (res.firestoreUpdated) {
              this.message = 'E-mail verificado com sucesso! Você pode continuar.';
            } else {
              this.message = 'E-mail verificado. Não conseguimos sincronizar seu perfil agora, mas isso será atualizado automaticamente.';
            }

            // Leva para o welcome com autocheck leve (sem forçar)
            this.ngZone.run(() => {
              setTimeout(() => this.router.navigate(['/register/welcome'],
                { queryParams: { autocheck: '1' } }), 1200);
            });
            return;
          }

          // Falha — personalize a razão
          this.verifyOk = false;
          this.showGoToLoginCTA = false;

          switch (res.reason) {
            case 'expired':
              this.message = 'O link de verificação expirou. Reenvie um novo e-mail.';
              this.showResendVerifyCTA = true;
              break;
            case 'invalid':
              this.message = 'O link de verificação é inválido ou já foi utilizado.';
              this.showResendVerifyCTA = true;
              break;
            case 'not-verified':
              this.message = 'Quase lá! Processamos o link, mas sua sessão ainda não refletiu a verificação. Tente novamente em alguns segundos ou reenvie o e-mail.';
              this.showResendVerifyCTA = true;
              break;
            default:
              this.message = 'Não foi possível verificar seu e-mail agora.';
              this.showResendVerifyCTA = true;
          }
        },
        error: (err) => {
          this.isLoading = false;
          this.verifyOk = false;
          this.showResendVerifyCTA = true;
          this.message = 'Erro ao verificar o e-mail.';
          this.globalErrorHandlerService.handleError(err);
        }
      });
  }

  resendVerificationEmail(): void {
    this.isLoading = true;
    this.emailVerificationService
      .resendVerificationEmail()
      .pipe(take(1), takeUntil(this.ngUnsubscribe))
      .subscribe({
        next: (txt) => {
          this.message = txt || 'E-mail reenviado. Verifique sua caixa de entrada e spam.';
          this.verifyOk = false;
          this.showResendVerifyCTA = false; // já reenviado
        },
        error: (err) => {
          this.message = 'Falha ao reenviar o e-mail de verificação.';
          this.globalErrorHandlerService.handleError(err);
        },
        complete: () => (this.isLoading = false),
      });
  }

  goToLogin(): void {
    this.router.navigate(['/login']);
  }

  goToWelcome(): void {
    this.router.navigate(
      ['/register/welcome'],
      { queryParams: { autocheck: '1' }, replaceUrl: true } // ✅ aqui dentro
    );
  }

  // === RESET DE SENHA ===
  async onSubmit(): Promise<void> {
    if (this.mode === 'resetPassword') {
      await this.resetPassword();
    }
  }

  async resetPassword(): Promise<void> {
    this.isLoading = true;
    this.shouldShowRecoveryLink = false;

    if (this.newPassword !== this.confirmPassword) {
      this.message = 'As senhas não coincidem.';
      this.isLoading = false;
      return;
    }
    if (this.newPassword.length < 8) {
      this.message = 'A senha deve ter pelo menos 8 caracteres.';
      this.isLoading = false;
      return;
    }

    try {
      await firstValueFrom(this.loginService.confirmPasswordReset$(this.oobCode, this.newPassword));
      this.message = 'Senha redefinida com sucesso! Redirecionando para o login...';
      this.newPassword = '';
      this.confirmPassword = '';

      this.ngZone.run(() => {
        setTimeout(() => this.router.navigate(['/login']), 1500);
      });
    } catch (error: any) {
      this.handlePasswordResetError(error);
    } finally {
      this.isLoading = false;
    }
  }

  private handlePasswordResetError(error: any): void {
    const code = error?.code;
    const resetErrors = ['auth/expired-action-code', 'auth/invalid-action-code'];

    if (resetErrors.includes(code)) {
      this.shouldShowRecoveryLink = true;
      this.message = code === 'auth/expired-action-code'
        ? 'O link de redefinição de senha expirou.'
        : 'O código de redefinição é inválido ou já foi usado.';
    } else {
      this.shouldShowRecoveryLink = true;
      this.message = 'Erro ao redefinir a senha.';
    }
  }

  // === utilitários / CTA auxiliares ===
  redirectToFAQ(): void {
    this.router.navigate(['/faq']);
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  openPasswordRecoveryModal(): void {
    this.emailInputModalService.openModal(); // ✅ agora existe e está injetado
  }

  // Fluxo de “finalização de cadastro” (mantido)
  finishRegistration(): void {
    this.message = 'Processando cadastro...';

    this.authService.getLoggedUserUID$().pipe(
      switchMap((uid) => {
        if (!uid) {
          this.message = 'Erro ao identificar o usuário. Por favor, tente novamente.';
          throw new Error('UID do usuário não encontrado.');
        }

        return this.firestoreUserQuery.getUser(uid).pipe(
          switchMap((existingUserData: IUserDados | null) => {
            if (!existingUserData) {
              this.message = 'Erro ao buscar dados do usuário. Tente novamente.';
              throw new Error('Dados do usuário não encontrados no Firestore.');
            }

            const userData: IUserRegistrationData = {
              uid,
              emailVerified: true,
              email: existingUserData.email || '',
              nickname: existingUserData.nickname || '',
              isSubscriber: existingUserData.isSubscriber || false,
              firstLogin: existingUserData.firstLogin || new Date(),
              gender: this.gender,
              orientation: this.orientation,
              estado: this.selectedEstado,
              municipio: this.selectedMunicipio,
              acceptedTerms: { accepted: true, date: new Date() }
            };

            return this.firestoreService.saveInitialUserData(uid, userData).pipe(
              tap(() => this.firestoreUserQuery.updateUserInStateAndCache(uid, userData))
            );
          })
        );
      }),
      take(1),
      takeUntil(this.ngUnsubscribe)
    ).subscribe({
      next: () => {
        this.message = 'Cadastro finalizado com sucesso!';
        this.showSubscriptionOptions = true;
        this.ngZone.run(() => {
          this.router.navigate(['/register/welcome'], {
            queryParams: { autocheck: '1' },
            replaceUrl: true
          });
        });
      },
      error: (error: any) => {
        this.message = 'Erro ao processar o cadastro. Por favor, tente novamente.';
        this.globalErrorHandlerService.handleError(error);
      }
    });
  }
}
