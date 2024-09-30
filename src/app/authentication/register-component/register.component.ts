// src\app\authentication\register-component\register.component.ts
import { Component } from '@angular/core';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { EmailVerificationService } from 'src/app/core/services/autentication/email-verification.service';
import { RegisterService } from 'src/app/core/services/autentication/register.service';

@Component({
  selector: 'app-register-component',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css']
})
export class RegisterComponent {
  public nickname: string = '';
  public email: string = '';
  public password: string = '';
  public errorMessage: string = '';
  public successMessage: string = '';
  public nicknameStatus: string = '';
  public passwordStrengthMessage: string = '';
  public selectedEstado: string = '';
  public selectedMunicipio: string = '';
  public formSubmitted: boolean = false;
  public isLoading: boolean = false;

  private failedAttempts: number = 0;
  private maxAttempts: number = 5;
  private lockoutTime: number = 30000; // Tempo de bloqueio em milissegundos (30 segundos)
  public isLockedOut: boolean = false;

  constructor(private registerService: RegisterService,
    private emailVerificationService: EmailVerificationService) { }

  async onRegister() {
    this.clearErrorMessages();

    // Se o usuário estiver bloqueado, impede novos envios
    if (this.isLockedOut) {
      this.errorMessage = 'Você atingiu o limite de tentativas. Tente novamente mais tarde.';
      return;
    }

    if (!this.isFormValid()) {
      return;
    }

    const userRegistrationData: IUserRegistrationData = {
      uid: '',
      email: this.email,
      nickname: this.nickname,
      photoURL: '',
      emailVerified: false,
      isSubscriber: false,
      estado: this.selectedEstado,
      municipio: this.selectedMunicipio,
      firstLogin: new Date()
    };

    this.isLoading = true;

    try {
      await this.registerService.registerUser(userRegistrationData, this.password);
      localStorage.setItem('tempNickname', this.nickname);
      this.successMessage = 'Registro realizado com sucesso! Por favor, verifique seu e-mail para confirmar.';
      this.formSubmitted = true;
      this.failedAttempts = 0;
    } catch (error: any) {
      this.handleRegistrationError(error);
    } finally {
      this.isLoading = false;
    }
  }

  clearErrorMessages(): void {
    this.errorMessage = '';
    this.successMessage = '';
  }

  clearError(): void {
    this.errorMessage = '';
  }

  isFormValid(): boolean {
    if (!this.email || !this.password || !this.nickname) {
      this.errorMessage = 'Todos os campos são obrigatórios.';
      return false;
    }

    if (!this.registerService.isValidEmailFormat(this.email)) {
      this.errorMessage = 'Endereço de e-mail inválido.';
      return false;
    }

    if (!this.registerService.isValidPassword(this.password)) {
      this.errorMessage = 'A senha deve conter pelo menos 8 caracteres, incluindo uma letra maiúscula, uma letra minúscula e um número.';
      return false;
    }

    return true;
  }

  checkNickname(): void {
    if (this.nickname.length >= 4 && this.nickname.length <= 25) {
      this.registerService.checkIfNicknameExists(this.nickname).then(exists => {
        this.nicknameStatus = exists ? 'Apelido já está em uso' : 'Apelido disponível';
      });
    } else {
      this.nicknameStatus = this.nickname.length > 25 ? 'Apelido muito longo' : '';
    }
  }

  checkPasswordStrength(): void {
    if (this.registerService.isValidPassword(this.password)) {
      this.passwordStrengthMessage = 'Senha forte';
    } else {
      this.passwordStrengthMessage = 'Senha fraca';
    }
  }

  async resendVerificationEmail(): Promise<void> {
    try {
      await this.emailVerificationService.resendVerificationEmail();
      this.successMessage = `E-mail de verificação reenviado para ${this.email}. Verifique sua caixa de entrada.`;
    } catch (error) {
      this.errorMessage = "Erro ao reenviar o e-mail de verificação.";
    }
  }

  handleRegistrationError(error: any): void {
    this.failedAttempts++;

    if (this.failedAttempts >= this.maxAttempts) {
      this.lockForm();
    }

    console.error('Erro completo:', JSON.stringify(error, null, 2));
    if ('code' in error) {
      switch (error.code) {
        case 'auth/weak-password':
          this.errorMessage = 'A senha deve conter pelo menos 6 caracteres.';
          break;
        case 'auth/email-already-in-use':
          this.errorMessage = 'Esse e-mail já está em uso.';
          break;
        case 'auth/invalid-email':
          this.errorMessage = 'Endereço de email inválido.';
          break;
        default:
          this.errorMessage = 'Ocorreu um erro desconhecido. Código: ' + error.code;
      }
    } else {
      this.errorMessage = 'Ocorreu um erro desconhecido.';
    }
  }

  lockForm(): void {
    this.isLockedOut = true;
    this.errorMessage = `Você tentou se registrar muitas vezes. Tente novamente em 30 segundos.`;

    setTimeout(() => {
      this.isLockedOut = false;
      this.failedAttempts = 0;
    }, this.lockoutTime);
  }
}
