// src\app\authentication\login-component\login-component.ts
import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { UserProfileService } from 'src/app/core/services/user-profile/user-profile.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Component({
  selector: 'app-login-component',
  templateUrl: './login-component.html',
  styleUrls: ['./login-component.css']
})
export class LoginComponent {
  email: string = '';
  password: string = '';
  honeypot: string = ''; // Campo honeypot
  errorMessage: string = '';
  isLoading: boolean = false;
  showPasswordRecovery: boolean = false;
  recoveryEmail: string = '';

  constructor(
    private authService: AuthService,
    private router: Router,
    private userProfileService: UserProfileService,
    private errorNotificationService: ErrorNotificationService
  ) { }

  // Limpar mensagens de erro
  clearError(): void {
    this.errorMessage = '';
  }

  // Validação de formato de e-mail com regex
  validateEmailFormat(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      this.errorMessage = 'Formato de e-mail inválido';
      return false;
    }
    return true;
  }

  // Verifica se o campo honeypot foi preenchido
  honeypotFilled(): boolean {
    return this.honeypot.length > 0;
  }

  // src/app/authentication/login-component/login-component.ts

  async login(): Promise<void> {
    this.clearError();

    if (!this.validateEmailFormat(this.email)) {
      return;  // Se o formato do e-mail for inválido, interrompe aqui
    }

    if (this.honeypotFilled()) {
      this.errorMessage = 'Detectado comportamento suspeito. Tente novamente.';
      return;  // Interrompe aqui se o honeypot for preenchido
    }

    this.isLoading = true;

    try {
      // Captura o retorno do login (boolean indicando sucesso ou falha)
      const loginSuccess = await this.authService.login(this.email, this.password);

      if (loginSuccess) {
        // O login foi bem-sucedido, não precisa fazer nada além, pois o AuthService já trata a navegação
      } else {
        // O login falhou, exibe a mensagem de erro e para o fluxo
        this.errorMessage = 'O e-mail não foi verificado. Verifique seu e-mail para ativar sua conta.';
        this.errorNotificationService.showError(this.errorMessage);
      }
    } catch (error) {
      this.handleError(error);  // Lida com outros tipos de erros
    } finally {
      this.isLoading = false;  // Finaliza o carregamento
    }
  }



  // Tratamento de erros genérico
  private handleError(error: any): void {
    this.errorMessage = 'Credenciais inválidas. Tente novamente.';
    console.error('Erro ao fazer login:', error);
    this.errorNotificationService.showError(this.errorMessage);
  }

  // Função para exibir modal de recuperação de senha
  onForgotPassword(): void {
    this.showPasswordRecovery = true;
    this.clearError(); // Limpar mensagem de erro ao abrir o modal
  }

  // Função para fechar o modal de recuperação de senha
  closePasswordRecovery(): void {
    this.showPasswordRecovery = false;
    this.recoveryEmail = ''; // Limpar campo de e-mail ao fechar o modal
    this.clearError(); // Limpar erros ao fechar o modal
  }

  // Envia e-mail de recuperação de senha
  async sendPasswordRecoveryEmail(): Promise<void> {
    this.clearError();

    if (!this.validateEmailFormat(this.recoveryEmail)) {
      return;
    }

    try {
      await this.authService.sendPasswordResetEmail(this.recoveryEmail);
      this.errorNotificationService.showSuccess('Instruções de recuperação de senha enviadas para seu e-mail.');
      this.closePasswordRecovery();
    } catch (error) {
      this.errorMessage = 'Erro ao enviar e-mail de recuperação. Tente novamente.';
      console.error(error);
    }
  }
}
