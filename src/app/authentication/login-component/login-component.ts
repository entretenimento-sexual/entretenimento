// src\app\authentication\login-component\login-component.ts
import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
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
  isLoading: boolean = false;
  showPasswordRecovery: boolean = false;
  recoveryEmail: string = '';

  constructor(
    private authService: AuthService,
    private router: Router,
    private errorNotificationService: ErrorNotificationService
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

  // Validação de formato de e-mail com regex
  validateEmailFormat(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      this.errorMessage = 'Formato de e-mail inválido';
      console.log(`Formato de e-mail inválido: ${email}`);
      return false;
    }
    return true;
  }

  // Método de login
  async login(): Promise<void> {
    console.log('Iniciando processo de login...');
    this.clearError();

    if (!this.validateEmailFormat(this.email)) {
      console.log('E-mail inválido. Interrompendo login.');
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
      const loginSuccess = await this.authService.login(this.email, this.password);

      if (loginSuccess) {
        console.log('Login bem-sucedido. Redirecionando...');
        this.router.navigate([`/perfil/${this.authService.getLoggedUserUID()}`]); // Use caminho absoluto
      } else {
        this.errorMessage = 'O e-mail não foi verificado. Verifique seu e-mail para ativar sua conta.';
        console.log('Login falhou: e-mail não verificado.');
        this.errorNotificationService.showError(this.errorMessage);
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

  // Função para abrir modal de recuperação de senha
  onForgotPassword(): void {
    this.showPasswordRecovery = true;
    this.clearError();
    console.log('Modal de recuperação de senha aberto.');
  }

  // Função para fechar modal de recuperação de senha
  closePasswordRecovery(): void {
    this.showPasswordRecovery = false;
    this.recoveryEmail = '';
    console.log('Modal de recuperação de senha fechado.');
    this.clearError();
  }

  // Envia e-mail de recuperação de senha
  async sendPasswordRecoveryEmail(): Promise<void> {
    this.clearError();
    console.log(`Enviando e-mail de recuperação de senha para: ${this.recoveryEmail}`);

    if (!this.validateEmailFormat(this.recoveryEmail)) {
      console.log('Formato de e-mail inválido para recuperação.');
      return;
    }

    try {
      await this.authService.sendPasswordResetEmail(this.recoveryEmail);
      console.log('E-mail de recuperação de senha enviado com sucesso.');
      this.errorNotificationService.showSuccess('Instruções de recuperação de senha enviadas para seu e-mail.');
      this.closePasswordRecovery();
    } catch (error) {
      this.errorMessage = 'Erro ao enviar e-mail de recuperação. Tente novamente.';
      console.error('Erro ao enviar e-mail de recuperação:', error);
    }
  }
}
