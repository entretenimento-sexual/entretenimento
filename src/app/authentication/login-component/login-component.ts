// src\app\authentication\login-component\login-component.ts
import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
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

  // Função de login
  async login(): Promise<void> {
    this.clearError();

    if (!this.validateEmailFormat(this.email)) {
      return;
    }

    if (this.honeypotFilled()) {
      this.errorMessage = 'Detectado comportamento suspeito. Tente novamente.';
      return;
    }

    this.isLoading = true;

    try {
      const user: IUserDados | null | undefined = await this.authService.login(this.email, this.password);

      if (user?.uid) {
        await this.userProfileService.atualizarEstadoOnlineUsuario(user.uid, true);
        this.router.navigate([`/perfil/${user.uid}`]);
      } else {
        this.router.navigate(['/perfil/meu-perfil']);
      }
    } catch (error) {
      this.handleError(error);
    } finally {
      this.isLoading = false;
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
