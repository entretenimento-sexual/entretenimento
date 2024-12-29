// src/app/core/services/autentication/login.service.ts
import { Injectable } from '@angular/core';
import { first } from 'rxjs';
import { getAuth, signInWithEmailAndPassword, sendPasswordResetEmail,
  confirmPasswordReset, setPersistence, browserLocalPersistence,
  browserSessionPersistence, EmailAuthProvider, Persistence, reauthenticateWithCredential
} from 'firebase/auth';
import { Router } from '@angular/router';
import { UsuarioService } from '../user-profile/usuario.service';
import { IUserDados } from '../../interfaces/iuser-dados';
import { AuthService } from './auth.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';
import { observeUserChanges } from 'src/app/store/actions/actions.user/user.actions';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { loginSuccess } from 'src/app/store/actions/actions.user/auth.actions';
import { doc, Timestamp, updateDoc } from '@firebase/firestore';
import { FirestoreService } from '../data-handling/firestore.service';
import { FirestoreQueryService } from '../data-handling/firestore-query.service';

// Inicializa o objeto de autenticação do Firebase
const auth = getAuth();

@Injectable({
  providedIn: 'root'
})
export class LoginService {

  constructor(
    private router: Router,
    private usuarioService: UsuarioService,
    private firestoreService: FirestoreService,
    private firestoreQuery: FirestoreQueryService,
    private authService: AuthService,
    private store: Store<AppState>,
    private globalErrorHandler: GlobalErrorHandlerService,  // Tratamento de erros globais
    private errorNotification: ErrorNotificationService     // Serviço de notificação de erro
  ) { }

  async login(email: string, password: string): Promise<{ success: boolean, emailVerified?: boolean, user?: IUserDados }> {
    const db = this.firestoreService.getFirestoreInstance();
    console.log(`Tentativa de login para o email: ${email}`);
    try {
      // Obtém o valor do campo "lembrar-me" do formulário
      const rememberMe = this.getRememberMeValue();
      // Define a persistência da sessão com base na escolha do usuário
      await this.setSessionPersistence(rememberMe ? browserLocalPersistence : browserSessionPersistence);
      console.log('Persistência de sessão definida.');

      // Realiza a autenticação do usuário
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      if (user) {
        console.log('Login bem-sucedido:', user.uid);

        // Busca os dados do usuário
        const userData = await this.firestoreQuery.getUser(user.uid).pipe(first()).toPromise();

        if (userData) {
          // Define o estado do usuário através do AuthService
          await this.authService.setCurrentUser(userData);
          this.store.dispatch(loginSuccess({ user: userData }));
          console.log('Dados do usuário carregados após login:', userData);

          // Atualiza o campo `lastLogin` diretamente no Firestore
          const timestampNow = Timestamp.fromDate(new Date());
          const userDocRef = doc(db, 'users', user.uid);
          await updateDoc(userDocRef, { lastLogin: timestampNow });
          console.log(`Data do último login atualizada para o usuário ${user.uid}.`);

          // Atualiza o status do usuário para online e armazena no Firestore
          await this.usuarioService.updateUserOnlineStatus(user.uid, true);
          this.store.dispatch(observeUserChanges({ uid: user.uid }));

          // Redirecionamento baseado no status do usuário
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
          await this.authService.logout(); // Corrigido: Chamando o método de logout do AuthService
          this.errorNotification.showError('Usuário não encontrado no sistema.');
        }
      } else {
        console.error('Falha no login: usuário não retornado.');
        await this.authService.logout(); // Corrigido: Chamando o método de logout do AuthService
        this.errorNotification.showError('Credenciais inválidas.');
      }
      return { success: false };
    } catch (error) {
      console.error('Erro ao fazer login:', error);
      this.globalErrorHandler.handleError(error as Error);
      this.errorNotification.showError('Erro ao realizar login. Tente novamente.');
      await this.authService.logout(); // Corrigido: Chamando o método de logout do AuthService
      return { success: false };
    }
  }

  // Método para definir a persistência da sessão
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

  // Método auxiliar para obter o valor do "lembrar-me" (simulação para o exemplo)
  private getRememberMeValue(): boolean {
    // Este método deve recuperar o valor do campo "lembrar-me" do formulário.
    // Ajuste conforme necessário no seu formulário (ex.: `this.loginForm.controls['rememberMe'].value`)
    return true; // Exemplo: retorna `true` se a opção "lembrar-me" estiver selecionada
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
