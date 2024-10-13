// src\app\core\services\autentication\login.service.ts
import { Injectable } from '@angular/core';
import { from, Observable, of, first } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import {
  getAuth, signInWithEmailAndPassword, sendPasswordResetEmail,
  confirmPasswordReset, setPersistence, browserLocalPersistence,
  EmailAuthProvider, Persistence, reauthenticateWithCredential
} from 'firebase/auth';
import { Router } from '@angular/router';
import { UsuarioService } from '../usuario.service';
import { IUserDados } from '../../interfaces/iuser-dados';
import { AuthService } from './auth.service';  // Importa o AuthService para manipular estado global

const auth = getAuth();

@Injectable({
  providedIn: 'root'
})
export class LoginService {

  constructor(
    private router: Router,
    private usuarioService: UsuarioService,
    private authService: AuthService  // Usa o AuthService para atualizar o estado do usuário
  ) { }

  // Login de usuário
  async login(email: string, password: string): Promise<{ success: boolean, emailVerified?: boolean }> {
    console.log(`Tentativa de login para o email: ${email}`);
    try {
      await setPersistence(auth, browserLocalPersistence);
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      if (user) {
        console.log('Login bem-sucedido:', user.uid);
        const userData = await this.usuarioService.getUsuario(user.uid).pipe(first()).toPromise();
        if (userData) {
          this.authService.setCurrentUser(userData);  // Atualiza o estado do usuário
          console.log('Dados do usuário carregados após login:', userData);

          // Verifica se o cadastro está completo
          if (!userData.nickname || !userData.gender) {
            this.router.navigate(['/finalizar-cadastro']);
          } else if (!userData.emailVerified) {
            return { success: true, emailVerified: false };  // Exibe modal de verificação
          } else {
            this.router.navigate([`/perfil/${user.uid}`]);
          }
        } else {
          console.log('Dados do usuário não encontrados no Firestore após login.');
          this.authService.clearCurrentUser();  // Limpa o estado se os dados do usuário não forem encontrados
        }
        return { success: true };  // Login bem-sucedido
      } else {
        console.error('Falha no login: usuário não retornado.');
        this.authService.clearCurrentUser();  // Limpa o estado em caso de falha
        return { success: false };
      }
    } catch (error) {
      console.error('Erro ao fazer login:', error);
      this.authService.clearCurrentUser();  // Limpa o estado em caso de erro
      return { success: false };
    }
  }

  // Envia o e-mail de recuperação de senha
  async sendPasswordResetEmail(email: string): Promise<void> {
    console.log('Enviando e-mail de recuperação de senha para:', email);
    try {
      await sendPasswordResetEmail(auth, email);
      console.log('E-mail de recuperação enviado.');
    } catch (error) {
      console.error('Erro ao enviar e-mail de recuperação:', error);
      throw error;
    }
  }

  // Confirma a redefinição de senha
  async confirmPasswordReset(oobCode: string, newPassword: string): Promise<void> {
    console.log('Confirmando redefinição de senha com oobCode:', oobCode);
    try {
      await confirmPasswordReset(auth, oobCode, newPassword);
      console.log('Senha redefinida com sucesso.');
    } catch (error) {
      console.error('Erro ao redefinir a senha:', error);
      throw error;
    }
  }

  // Define a persistência da sessão
  async setSessionPersistence(persistence: Persistence): Promise<void> {
    try {
      await setPersistence(auth, persistence);
      console.log('Persistência de sessão definida.');
    } catch (error) {
      console.error('Erro ao definir persistência de sessão:', error);
      throw error;
    }
  }

  // Reautenticação do usuário
  async reauthenticateUser(password: string): Promise<void> {
    const user = auth.currentUser;
    if (user && user.email) {
      const credential = EmailAuthProvider.credential(user.email, password);
      try {
        await reauthenticateWithCredential(user, credential);
        console.log('Reautenticação bem-sucedida.');
      } catch (error) {
        console.error('Erro ao reautenticar usuário:', error);
        throw error;
      }
    } else {
      throw new Error('Usuário não autenticado');
    }
  }
}
