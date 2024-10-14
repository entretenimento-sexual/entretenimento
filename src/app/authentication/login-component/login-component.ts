// src\app\authentication\login-component\login-component.ts
import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { EmailInputModalService } from 'src/app/core/services/autentication/email-input-modal.service';
import { EmailVerificationService } from 'src/app/core/services/autentication/email-verification.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { LoginService } from 'src/app/core/services/autentication/login.service';
import { browserLocalPersistence, browserSessionPersistence, getAuth, User } from 'firebase/auth';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { Observable } from 'rxjs';
import { FirestoreService } from 'src/app/core/services/autentication/firestore.service';

@Component({
  selector: 'app-login-component',
  templateUrl: './login-component.html',
  styleUrls: ['./login-component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class LoginComponent implements OnInit {
  loginForm!: FormGroup;
  honeypot: string = '';
  errorMessage: string = '';
  successMessage: string = '';
  isLoading: boolean = false;
  showEmailVerificationModal: boolean = false;

  // Observables para os estados do usuário
  isAuthenticated$!: Observable<boolean>;
  hasRequiredFields$!: Observable<boolean>;

  constructor(
    private router: Router,
    private errorNotificationService: ErrorNotificationService,
    public emailInputModalService: EmailInputModalService,
    public emailVerificationService: EmailVerificationService,
    private firestoreService: FirestoreService,
    private loginservice: LoginService,
    private authService: AuthService,
    private formBuilder: FormBuilder
  ) { }

  ngOnInit(): void {
    console.log('Componente de login carregado.');
    this.initializeForm();
  }

  // Inicializa o FormGroup com validações
  initializeForm(): void {
    this.loginForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required],
      honeypot: [''],
      rememberMe: [false]
    });
  }

  // Getters para simplificar o acesso no template
  get email() {
    return this.loginForm.get('email');
  }

  get password() {
    return this.loginForm.get('password');
  }

  get isHoneypotFilled(): boolean {
    return this.honeypot.length > 0;
  }

 // Método de login
  async login(): Promise<void> {
    this.clearError();

    const rememberMe = this.loginForm.controls['rememberMe']?.value;
    await this.loginservice.setSessionPersistence(rememberMe ? browserLocalPersistence : browserSessionPersistence);

    if (this.isHoneypotFilled) {
      this.errorMessage = 'Detectado comportamento suspeito. Tente novamente.';
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

      const { success, emailVerified } = await this.loginservice.login(email, password);

      if (success) {
        if (!emailVerified) {
          this.showEmailVerificationModal = true;
        } else {
          this.successMessage = 'Login realizado com sucesso!';
          this.errorNotificationService.showSuccess(this.successMessage);  // Mostra uma mensagem de sucesso
          this.router.navigate(['/dashboard']);
        }
      } else {
        this.errorMessage = 'Credenciais inválidas.';
        this.errorNotificationService.showError(this.errorMessage);
      }
    } catch (error) {
      this.handleError(error);
    } finally {
      this.isLoading = false;
    }
  }

  // Tratamento de erros
  private handleError(error: any): void {
    switch (error.code) {
      case 'auth/user-not-found':
        this.errorMessage = 'Usuário não encontrado. Verifique o e-mail inserido.';
        break;
      case 'auth/wrong-password':
        this.errorMessage = 'Senha incorreta. Tente novamente.';
        break;
      case 'auth/user-disabled':
        this.errorMessage = 'Este usuário foi desativado.';
        break;
      case 'auth/too-many-requests':
        this.errorMessage = 'Muitas tentativas falhas. Por favor, tente mais tarde.';
        break;
      default:
        this.errorMessage = 'Erro inesperado. Tente novamente mais tarde.';
    }
    this.errorNotificationService.showError(this.errorMessage);
  }

  // Limpar mensagens de erro
  clearError(): void {
    this.errorMessage = '';
  }

  // Abre o modal de recuperação de senha
  openPasswordRecoveryModal(): void {
    this.emailInputModalService.openModal();
  }

  // Reenvia o e-mail de verificação
  async resendVerificationEmail(): Promise<void> {
    try {
      await this.emailVerificationService.resendVerificationEmail();
      this.successMessage = `E-mail de verificação reenviado para ${this.loginForm.value.email}. Verifique sua caixa de entrada.`;
    } catch (error) {
      this.errorMessage = "Erro ao reenviar o e-mail de verificação.";
    }
  }

    logout(): void {
      this.authService.logout()
  }
}
