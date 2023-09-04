// src\app\authentication\register-component\register.component.ts
import { Component } from '@angular/core';
import { AuthService } from 'src/app/core/services/autentication/auth.service'; // Importe o serviço de autenticação que você criou

@Component({
  selector: 'app-register-component',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css', '../authentication.css']
})
export class RegisterComponent {
  public nickname: string = '';
  public email: string = '';
  public password: string = '';
  public errorMessage: string = '';  // Para armazenar mensagens de erro
  public successMessage: string = '';  // Para armazenar mensagens de sucesso
  public nicknameStatus: string = '';  // Para armazenar o status do apelido

  constructor(private authService: AuthService) { }

  async onRegister() {
    this.errorMessage = '';
    this.successMessage = '';

    try {
      await this.authService.register(this.email, this.password, this.nickname);
      this.successMessage = 'Seu cadastro foi iniciado com sucesso. Enviamos um e-mail de verificação, entre no seu e-mail para validar o e-mail e continuar seu cadastro.';
    } catch (error: any) {
      console.error('Erro completo:', JSON.stringify(error, null, 2)); // Isso irá ajudá-lo a ver o erro completo
      if ('code' in error) {
        if (error.code === 'auth/weak-password') {
          this.errorMessage = 'A senha deve ter pelo menos 6 caracteres.';
        } else if (error.code === 'auth/email-already-in-use') {
          this.errorMessage = 'Esse e-mail já está em uso.';
        } else if (error.code === 'auth/invalid-email') {
          this.errorMessage = 'Endereço de email inválido';
        } else {
          this.errorMessage = 'Ocorreu um erro desconhecido. Código: ' + error.code;
        }
      } else {
        this.errorMessage = 'Ocorreu um erro desconhecido.';
      }
    }
  }
  async checkNickname() {
    if (this.nickname.length >= 3 && this.nickname.length <= 20) {
      const exists = await this.authService.checkIfNicknameExists(this.nickname);
      if (exists) {
        this.nicknameStatus = 'Apelido já está em uso';
      } else {
        this.nicknameStatus = 'Apelido disponível';
      }
    } else if (this.nickname.length > 20) {
      this.nicknameStatus = 'Apelido muito longo';
    } else {
      this.nicknameStatus = '';
    }
  }
}

