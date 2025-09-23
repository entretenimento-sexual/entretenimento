// src/app/authentication/login-component/login-component.ts
import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { EmailInputModalService } from 'src/app/core/services/autentication/email-input-modal.service';
import { EmailVerificationService } from 'src/app/core/services/autentication/register/email-verification.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { LoginService } from 'src/app/core/services/autentication/login.service';
import { browserLocalPersistence, browserSessionPersistence } from 'firebase/auth';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { firstValueFrom, Observable } from 'rxjs';

@Component({
  selector: 'app-login-component',
  templateUrl: './login-component.html',
  styleUrls: ['./login-component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class LoginComponent implements OnInit {
  loginForm!: FormGroup;
  honeypot = '';
  errorMessage = '';
  successMessage = '';
  isLoading = false;
  showEmailVerificationModal = false;

  isAuthenticated$!: Observable<boolean>;
  hasRequiredFields$!: Observable<boolean>;

  constructor(
    private router: Router,
    private errorNotificationService: ErrorNotificationService,
    public emailInputModalService: EmailInputModalService,
    public emailVerificationService: EmailVerificationService,
    private loginservice: LoginService,
    private authService: AuthService,
    private formBuilder: FormBuilder
  ) { }

  ngOnInit(): void {
    this.initializeForm();
  }

  initializeForm(): void {
    this.loginForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required],
      honeypot: [''],
      rememberMe: [false]
    });
  }

  get email() { return this.loginForm.get('email'); }
  get password() { return this.loginForm.get('password'); }
  get isHoneypotFilled(): boolean { return this.honeypot.length > 0; }

  async login(): Promise<void> {
    this.clearError();

    const rememberMe = !!this.loginForm.get('rememberMe')?.value;
    await firstValueFrom(
      this.loginservice.setSessionPersistence$(rememberMe ? browserLocalPersistence : browserSessionPersistence)
    );

    if (this.isHoneypotFilled) {
      this.errorMessage = 'Detectado comportamento suspeito. Tente novamente.';
      this.errorNotificationService.showError(this.errorMessage);
      return;
    }

    if (this.loginForm.invalid) {
      this.errorMessage = 'Por favor, preencha o formulário corretamente.';
      this.errorNotificationService.showError(this.errorMessage);
      return;
    }

    this.isLoading = true;
    try {
      const email = this.email?.value;
      const password = this.password?.value;

      const result = await firstValueFrom(this.loginservice.login$(email, password, rememberMe));

      if (result.success) {
        if (result.needsProfileCompletion) {
          await this.router.navigate(['/finalizar-cadastro']);
          return;
        }
        if (!result.emailVerified) {
          this.showEmailVerificationModal = true;
          this.successMessage = '';
        } else {
          this.successMessage = 'Login realizado com sucesso!';
          this.errorNotificationService.showSuccess(this.successMessage);
          await this.router.navigate(['/dashboard']);
        }
      } else {
        this.errorMessage = result.message || 'Não foi possível entrar. Tente novamente.';
        this.errorNotificationService.showError(this.errorMessage);
      }
    } catch (error: any) {
      this.handleError(error);
    } finally {
      this.isLoading = false;
    }
  }

  private handleError(error: any): void {
    const code = error?.code as string | undefined;
    switch (code) {
      case 'auth/user-not-found':
        this.errorMessage = 'Usuário não encontrado. Verifique o e-mail inserido.'; break;
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        this.errorMessage = 'E-mail ou senha incorretos.'; break;
      case 'auth/user-disabled':
        this.errorMessage = 'Este usuário foi desativado.'; break;
      case 'auth/too-many-requests':
        this.errorMessage = 'Muitas tentativas falhas. Por favor, tente mais tarde.'; break;
      case 'auth/network-request-failed':
        this.errorMessage = 'Falha de conexão ao autenticar. Verifique sua internet ou tente novamente.'; break;
      default:
        this.errorMessage = 'Erro inesperado. Tente novamente mais tarde.';
    }
    this.errorNotificationService.showError(this.errorMessage);
  }

  clearError(): void { this.errorMessage = ''; }

  openPasswordRecoveryModal(): void {
    this.emailInputModalService.openModal();
  }

  async resendVerificationEmail(): Promise<void> {
    try {
      const msg = await firstValueFrom(this.emailVerificationService.resendVerificationEmail());
      this.successMessage = msg ?? 'E-mail de verificação reenviado. Verifique sua caixa de entrada.';
      this.errorNotificationService.showSuccess(this.successMessage);
    } catch {
      this.errorMessage = 'Erro ao reenviar o e-mail de verificação.';
      this.errorNotificationService.showError(this.errorMessage);
    }
  }

  logout(): void {
    this.authService.logout().subscribe(() => { });
  }
}
