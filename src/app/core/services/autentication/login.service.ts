// src/app/core/services/autentication/login.service.ts
import { Injectable } from '@angular/core';
import { first } from 'rxjs';
import {
  getAuth, signInWithEmailAndPassword, sendPasswordResetEmail,
  confirmPasswordReset, setPersistence, browserLocalPersistence,
  EmailAuthProvider, Persistence, reauthenticateWithCredential
} from 'firebase/auth';
import { Router } from '@angular/router';
import { UsuarioService } from '../usuario.service';
import { IUserDados } from '../../interfaces/iuser-dados';
import { AuthService } from './auth.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';
import { observeUserChanges } from 'src/app/store/actions/actions.user/user.actions';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';

// Inicializa o objeto de autenticação do Firebase
const auth = getAuth();

@Injectable({
  providedIn: 'root'
})
export class LoginService {

  constructor(
    private router: Router,
    private usuarioService: UsuarioService,
    private authService: AuthService,
    private store: Store<AppState>,
    private globalErrorHandler: GlobalErrorHandlerService,  // Tratamento de erros globais
    private errorNotification: ErrorNotificationService     // Serviço de notificação de erro
  ) { }

  async login(email: string, password: string): Promise<{ success: boolean, emailVerified?: boolean, user?: IUserDados }> {
    console.log(`Tentativa de login para o email: ${email}`);
    try {
      await setPersistence(auth, browserLocalPersistence);
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      if (user) {
        console.log('Login bem-sucedido:', user.uid);
       
        await this.usuarioService.updateUserOnlineStatus(user.uid, true);
        this.store.dispatch(observeUserChanges({ uid: user.uid }));

        const userData = await this.usuarioService.getUsuario(user.uid).pipe(first()).toPromise();


        if (userData) {
          this.authService.setCurrentUser(userData);
          console.log('Dados do usuário carregados após login:', userData);

          if (!userData.nickname || !userData.gender) {
            this.router.navigate(['/finalizar-cadastro']);
          } else if (!user.emailVerified) {
            return { success: true, emailVerified: false, user: userData };
          } else {
            this.router.navigate([`/perfil/${user.uid}`]);
          }
          return { success: true, emailVerified: user.emailVerified, user: userData };
        } else {
          console.log('Dados do usuário não encontrados no Firestore após login.');
          this.authService.logoutAndClearUser();
          this.errorNotification.showError('Usuário não encontrado no sistema.');
        }
        return { success: true };
      } else {
        console.error('Falha no login: usuário não retornado.');
        this.authService.logoutAndClearUser();
        this.errorNotification.showError('Credenciais inválidas.');
        return { success: false };
      }
    } catch (error) {
      console.error('Erro ao fazer login:', error);
      this.globalErrorHandler.handleError(error as Error);  // Converte para tipo Error
      this.errorNotification.showError('Erro ao realizar login. Tente novamente.');
      this.authService.logoutAndClearUser();
      return { success: false };
    }
  }

  async sendPasswordResetEmail(email: string): Promise<void> {
    console.log('Enviando e-mail de recuperação de senha para:', email);
    try {
      await sendPasswordResetEmail(auth, email);
      console.log('E-mail de recuperação enviado.');
    } catch (error) {
      console.error('Erro ao enviar e-mail de recuperação:', error);
      this.globalErrorHandler.handleError(error as Error);
      this.errorNotification.showError('Erro ao enviar o e-mail de recuperação. Tente novamente.');
      throw error;
    }
  }

  async confirmPasswordReset(oobCode: string, newPassword: string): Promise<void> {
    console.log('Confirmando redefinição de senha com oobCode:', oobCode);
    try {
      await confirmPasswordReset(auth, oobCode, newPassword);
      console.log('Senha redefinida com sucesso.');
    } catch (error) {
      console.error('Erro ao redefinir a senha:', error);
      this.globalErrorHandler.handleError(error as Error);
      this.errorNotification.showError('Erro ao redefinir a senha. Tente novamente.');
      throw error;
    }
  }

  async setSessionPersistence(persistence: Persistence): Promise<void> {
    try {
      await setPersistence(auth, persistence);
      console.log('Persistência de sessão definida.');
    } catch (error) {
      console.error('Erro ao definir persistência de sessão:', error);
      this.globalErrorHandler.handleError(error as Error);
      this.errorNotification.showError('Erro ao definir a persistência de sessão.');
      throw error;
    }
  }

  async reauthenticateUser(password: string): Promise<void> {
    const user = auth.currentUser;
    if (user && user.email) {
      const credential = EmailAuthProvider.credential(user.email, password);
      try {
        await reauthenticateWithCredential(user, credential);
        console.log('Reautenticação bem-sucedida.');
      } catch (error) {
        console.error('Erro ao reautenticar usuário:', error);
        this.globalErrorHandler.handleError(error as Error);
        this.errorNotification.showError('Erro ao reautenticar o usuário. Verifique a senha e tente novamente.');
        throw error;
      }
    } else {
      throw new Error('Usuário não autenticado');
    }
  }
}
