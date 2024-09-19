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
  styleUrls: ['./login-component.css', '../authentication.css']
})
export class LoginComponent {
  email: string = '';
  password: string = '';
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

  clearError(): void {
    this.errorMessage = '';
  }

  async login(): Promise<void> {
    this.isLoading = true;
    this.clearError();

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

  private handleError(error: any): void {
    if (error.code === 'auth/wrong-password') {
      this.errorMessage = 'Senha incorreta. Tente novamente.';
    } else if (error.code === 'auth/user-not-found') {
      this.errorMessage = 'Usuário não encontrado. Verifique o email ou cadastre-se.';
    } else if (error.code === 'auth/invalid-email') {
      this.errorMessage = 'O formato do e-mail é inválido.';
    } else {
      this.errorMessage = 'Erro ao fazer login. Tente novamente.';
    }

    this.errorNotificationService.showError(this.errorMessage);
    console.error('Erro ao fazer login:', error);
  }

  // Função de recuperação de senha
  onForgotPassword(): void {
    this.showPasswordRecovery = true;
  }

  closePasswordRecovery(): void {
    this.showPasswordRecovery = false;
  }

  // Função para enviar o e-mail de recuperação de senha
  async sendPasswordRecoveryEmail(): Promise<void> {
    if (!this.recoveryEmail) {
      this.errorMessage = 'Por favor, insira um e-mail válido.';
      return;
    }

    try {
      await this.authService.sendPasswordResetEmail(this.recoveryEmail);  // Chama a função correta do AuthService
      this.errorNotificationService.showSuccess('Instruções de recuperação de senha enviadas para seu e-mail.');
      this.closePasswordRecovery();
    } catch (error) {
      this.errorMessage = 'Erro ao enviar e-mail de recuperação. Tente novamente.';
      console.error(error);
    }
  }
}
