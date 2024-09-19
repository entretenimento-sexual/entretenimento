// src\app\authentication\register-component\register.component.ts
import { Component } from '@angular/core';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';

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

  constructor(private authService: AuthService) { }

  async onRegister() {
    this.clearErrorMessages();

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
      await this.authService.register(userRegistrationData, this.password);
      localStorage.setItem('tempNickname', this.nickname);
      this.successMessage = 'Registro realizado com sucesso! Por favor, verifique seu e-mail para confirmar.';
      this.formSubmitted = true;
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

  // Função clearError para limpar a mensagem de erro quando o input é alterado
  clearError(): void {
    this.errorMessage = '';
  }

  isFormValid(): boolean {
    if (!this.email || !this.password || !this.nickname) {
      this.errorMessage = 'Todos os campos são obrigatórios.';
      return false;
    }

    if (this.password.length < 6) {
      this.errorMessage = 'A senha deve ter pelo menos 6 caracteres.';
      return false;
    }

    return true;
  }

  checkNickname(): void {
    if (this.nickname.length >= 3 && this.nickname.length <= 25) {
      this.authService.checkIfNicknameExists(this.nickname).then(exists => {
        this.nicknameStatus = exists ? 'Apelido já está em uso' : 'Apelido disponível';
      });
    } else {
      this.nicknameStatus = this.nickname.length > 25 ? 'Apelido muito longo' : '';
    }
  }

  checkPasswordStrength(): void {
    this.passwordStrengthMessage = this.password.length >= 8 ? 'Senha forte' : 'Senha fraca';
  }

  async resendVerificationEmail(): Promise<void> {
    try {
      await this.authService.resendVerificationEmail();
      this.successMessage = `E-mail de verificação reenviado para ${this.email}. Verifique sua caixa de entrada.`;
    } catch (error) {
      this.errorMessage = "Erro ao reenviar o e-mail de verificação.";
    }
  }

  handleRegistrationError(error: any): void {
    console.error('Erro completo:', JSON.stringify(error, null, 2));
    if ('code' in error) {
      switch (error.code) {
        case 'auth/weak-password':
          this.errorMessage = 'A senha deve ter pelo menos 6 caracteres.';
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
}
