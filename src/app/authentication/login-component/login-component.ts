// src\app\authentication\login-component\login-component.ts
import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { EmailInputModalService } from 'src/app/core/services/autentication/email-input-modal.service';
import { EmailVerificationService } from 'src/app/core/services/autentication/email-verification.service';
import { ValidatorService } from 'src/app/core/services/data-handling/validator.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Component({
  selector: 'app-login-component',
  templateUrl: './login-component.html',
  styleUrls: ['./login-component.css']
})

export class LoginComponent implements OnInit {
  email: string = '';
  password: string = '';
  honeypot: string = ''; // Campo honeypot
  errorMessage: string = '';
  successMessage: string = '';
  isLoading: boolean = false;
  showEmailVerificationModal: boolean = false;

  constructor(
    private authService: AuthService,
    private router: Router,
    private errorNotificationService: ErrorNotificationService,
    public emailInputModalService: EmailInputModalService,
    public emailVerificationService: EmailVerificationService,
    private validatorService: ValidatorService
  ) { }

  ngOnInit(): void {
    console.log('Componente de login carregado.');
    this.clearError();
  }

  // Limpar mensagens de erro
  clearError(): void {
    this.errorMessage = '';
    console.log('Mensagens de erro limpas.');
  }

  // Getter para honeypot
  get isHoneypotFilled(): boolean {
    return this.honeypot.length > 0;
  }

  // Método de login
  async login(): Promise<void> {
    console.log('Iniciando processo de login...');
    this.clearError();

    if (!ValidatorService.isValidEmail(this.email)) {
      console.log('E-mail inválido. Interrompendo login.');
      this.errorMessage = 'Formato de e-mail inválido';
      return;
    }

    if (this.isHoneypotFilled) {
      this.errorMessage = 'Detectado comportamento suspeito. Tente novamente.';
      console.log('Honeypot preenchido. Login interrompido.');
      return;
    }

    this.isLoading = true;
    console.log('Login em progresso...');

    try {
      const { success, emailVerified } = await this.authService.login(this.email, this.password);

      if (success) {
        if (emailVerified === false) {
          // Exibe o modal de verificação de e-mail
          console.log('E-mail não verificado, abrindo modal...');
          this.showEmailVerificationModal = true;
        }
      } else {
        this.errorMessage = 'Credenciais inválidas.';
      }
    } catch (error) {
      this.handleError(error);
    } finally {
      this.isLoading = false;
      console.log('Processo de login finalizado.');
    }
  }

  // Tratamento de erros
  private handleError(error: any): void {
    this.errorMessage = 'Credenciais inválidas. Tente novamente.';
    console.error('Erro ao fazer login:', error);
    this.errorNotificationService.showError(this.errorMessage);
  }

  async resendVerificationEmail(): Promise<void> {
    try {
      await this.emailVerificationService.resendVerificationEmail();
      this.successMessage = `E-mail de verificação reenviado para ${this.email}. Verifique sua caixa de entrada.`;
    } catch (error) {
      this.errorMessage = "Erro ao reenviar o e-mail de verificação.";
    }
  }

  logout(): void {
    this.authService.logout().subscribe(() => {
      console.log('Usuário deslogado.');
      this.router.navigate(['/login']);
    });
  }

  // Abre o modal de recuperação de senha
  openPasswordRecoveryModal(): void {
    this.emailInputModalService.openModal();
  }
}
