// src\app\authentication\login-component\login-component.ts
import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { UserProfileService } from 'src/app/core/services/user-profile/user-profile.service';

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

  constructor(private authService: AuthService, private router: Router,
              private userProfileService: UserProfileService  ) { }

  async login(): Promise<void> {
    try {
      // Tenta autenticar o usuário com o AuthService
      const user: IUserDados | null | undefined = await this.authService.login(this.email, this.password);

      // Se a autenticação for bem-sucedida e o UID do usuário estiver presente
      if (user?.uid) {
        // Atualiza o estado online do usuário como verdadeiro
        await this.userProfileService.atualizarEstadoOnlineUsuario(user.uid, true);

        // Redireciona para a página de perfil do usuário
        this.router.navigate([`/perfil/${user.uid}`]);
      } else {
        // Se o UID do usuário não for encontrado, redireciona para um perfil padrão
        console.warn('UID do usuário não encontrado, redirecionando para o perfil padrão');
        this.router.navigate(['/perfil/meu-perfil']);
      }
    } catch (error) {
      // Se houver um erro durante o processo de login, mostra uma mensagem de erro
      if (typeof error === 'object' && error !== null && 'message' in error) {
        this.errorMessage = "Erro ao fazer login: " + error.message;
      } else {
        this.errorMessage = "Erro ao fazer login.";
      }
      console.error('Erro ao fazer login:', error);
    }
  }
}
