// src\app\authentication\login-component\login-component.ts
import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AuthService } from 'src/app/core/services/autentication/auth.service';

@Component({
  selector: 'app-login-component',
  templateUrl: './login-component.html',
  styleUrls: ['./login-component.css', '../authentication.css']
})
export class LoginComponent {
  email: string = '';
  password: string = '';
  errorMessage: string = '';
  uid: string | null = null;

  constructor(private authService: AuthService, private router: Router) { }

  async login(): Promise<void> {
    try {
      const user: IUserDados | null | undefined = await this.authService.login(this.email, this.password);
      // Atualizando a propriedade uid com o valor retornado após o login
      this.uid = user?.uid || null;

      if (this.uid) {
        this.router.navigate([`/perfil/${this.uid}`]);
      } else {
        console.warn('UID do usuário não encontrado, redirecionando para o perfil padrão');
        this.router.navigate(['/perfil/meu-perfil']);
      }

    } catch (error) {
      if (typeof error === 'object' && error !== null && 'message' in error) {
        this.errorMessage = "Erro ao fazer login: " + error.message;
      } else {
        this.errorMessage = "Erro ao fazer login.";
      }
      console.error('Erro ao fazer login:', error);
    }
  }
}
