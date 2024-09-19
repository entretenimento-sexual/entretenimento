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
  actionCode: string | null = null; // OobCode capturado da URL
  errorMessage: string = '';

  constructor(
    private route: ActivatedRoute,
    private authService: AuthService,
    private router: Router,
    private errorNotificationService: ErrorNotificationService
  ) { }

  ngOnInit(): void {
    // Captura o oobCode da URL
    this.route.queryParams.subscribe(params => {
      this.actionCode = params['oobCode'];
      if (!this.actionCode) {
        this.errorMessage = 'Código inválido ou ausente.';
      }
    });
  }

  // Função para redefinir a senha
  async resetPassword(): Promise<void> {
    if (this.newPassword !== this.confirmPassword) {
      this.errorMessage = 'As senhas não coincidem.';
      return;
    }

    if (this.actionCode) {
      try {
        // Chama o serviço para redefinir a senha usando o oobCode
        await this.authService.confirmPasswordReset(this.actionCode, this.newPassword);
        this.errorNotificationService.showSuccess('Senha redefinida com sucesso!');
        this.router.navigate(['/login']); // Redireciona para a página de login após a redefinição
      } catch (error) {
        this.errorMessage = 'Erro ao redefinir a senha. Por favor, tente novamente.';
        console.error(error);
      }
    } else {
      this.errorMessage = 'Código de redefinição de senha inválido.';
    }
  }
}
