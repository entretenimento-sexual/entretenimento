// src\app\authentication\reset-password\reset-password.component.ts
import { Component } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Component({
  selector: 'app-reset-password',
  templateUrl: './reset-password.component.html',
  styleUrls: ['./reset-password.component.css']
})
export class ResetPasswordComponent {
  newPassword: string = '';
  confirmPassword: string = '';
  actionCode: string | null = null;
  errorMessage: string = '';
  passwordStrengthMessage: string = '';
  showSuccessMessage: boolean = false; // Controle para exibir o modal de sucesso

  constructor(
    private route: ActivatedRoute,
    private authService: AuthService,
    private router: Router,
    private errorNotificationService: ErrorNotificationService
  ) { }

  ngOnInit(): void {
    // Captura o oobCode da URL (Código para redefinição)
    this.route.queryParams.subscribe(params => {
      this.actionCode = params['oobCode'];
      if (!this.actionCode) {
        this.errorMessage = 'Código inválido ou ausente.';
      }
    });
  }

  // Função para verificar a força da senha
  checkPasswordStrength(): void {
    this.passwordStrengthMessage = this.newPassword.length >= 8 ? 'Senha forte' : 'Senha fraca';
  }

  // Função para redefinir a senha
  async resetPassword(): Promise<void> {
    if (!this.actionCode) {
      this.errorMessage = 'Código de redefinição de senha inválido.';
      return;
    }

    if (this.newPassword !== this.confirmPassword) {
      this.errorMessage = 'As senhas não coincidem.';
      return;
    }

    if (this.newPassword.length < 6) {
      this.errorMessage = 'A senha deve ter pelo menos 6 caracteres.';
      return;
    }

    try {
      // Chama o serviço para confirmar a redefinição da senha com o oobCode
      await this.authService.confirmPasswordReset(this.actionCode, this.newPassword);
      this.showSuccessMessage = true; // Exibe o modal de sucesso

      setTimeout(() => {
        this.router.navigate(['/login']);
      }, 4000); // Aguarda 3 segundos antes de redirecionar para a página de login
    } catch (error) {
      this.errorMessage = 'Erro ao redefinir a senha. Por favor, tente novamente.';
      console.error('Erro ao redefinir a senha:', error);
    }
  }
}
