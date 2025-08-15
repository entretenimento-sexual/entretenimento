// src/app/core/services/autentication/login.service.ts
import { Injectable } from '@angular/core';
import { first } from 'rxjs';
import {
  getAuth, signInWithEmailAndPassword, sendPasswordResetEmail,
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

// 🔁 use os helpers do AngularFire Firestore (MESMA instância do app)
import { doc, Timestamp, updateDoc } from '@angular/fire/firestore';

import { FirestoreService } from '../data-handling/firestore.service';
import { FirestoreUserQueryService } from '../data-handling/firestore-user-query.service';

// 👇 garante app inicializado antes de pegar o auth
import { getApps, initializeApp } from 'firebase/app';
import { environment } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class LoginService {
  // ✅ Só declara
  private auth!: ReturnType<typeof getAuth>;

  constructor(
    private router: Router,
    private usuarioService: UsuarioService,
    private firestoreService: FirestoreService,
    private firestoreUserQuery: FirestoreUserQueryService,
    private authService: AuthService,
    private store: Store<AppState>,
    private globalErrorHandler: GlobalErrorHandlerService,
    private errorNotification: ErrorNotificationService
  ) {
    // ✅ evita app/no-app
    if (!getApps().length) {
      initializeApp(environment.firebase);
    }
    this.auth = getAuth();
  }

  async login(email: string, password: string): Promise<{ success: boolean, emailVerified?: boolean, user?: IUserDados }> {
    const db = this.firestoreService.getFirestoreInstance();
    console.log(`Tentativa de login para o email: ${email}`);
    try {
      const rememberMe = this.getRememberMeValue();
      await this.setSessionPersistence(rememberMe ? browserLocalPersistence : browserSessionPersistence);

      // ✅ use a instância já garantida
      const userCredential = await signInWithEmailAndPassword(this.auth, email, password);
      const user = userCredential.user;

      if (user) {
        console.log('Login bem-sucedido:', user.uid);

        const userData = await this.firestoreUserQuery.getUser(user.uid).pipe(first()).toPromise();

        if (userData) {
          // `setCurrentUser` não é async, mas manter `await` não quebra
          await this.authService.setCurrentUser(userData as any);
          this.store.dispatch(loginSuccess({ user: userData }));

          const timestampNow = Timestamp.fromDate(new Date());
          const userDocRef = doc(db, 'users', user.uid);
          await updateDoc(userDocRef, { lastLogin: timestampNow });

          await this.usuarioService.updateUserOnlineStatus(user.uid, true);
          this.store.dispatch(observeUserChanges({ uid: user.uid }));

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
          await this.authService.logout();
          this.errorNotification.showError('Usuário não encontrado no sistema.');
        }
      } else {
        console.log('Falha no login: usuário não retornado.');
        await this.authService.logout();
        this.errorNotification.showError('Credenciais inválidas.');
      }
      return { success: false };
    } catch (error) {
      console.log('Erro ao fazer login:', error);
      this.globalErrorHandler.handleError(error as Error);
      this.errorNotification.showError('Erro ao realizar login. Tente novamente.');
      await this.authService.logout();
      return { success: false };
    }
  }

  async setSessionPersistence(persistence: Persistence): Promise<void> {
    try {
      await setPersistence(this.auth, persistence); // ✅ this.auth
      console.log('Persistência de sessão definida.');
    } catch (error) {
      console.log('Erro ao definir persistência de sessão:', error);
      this.globalErrorHandler.handleError(error as Error);
      this.errorNotification.showError('Erro ao definir a persistência de sessão.');
      throw error;
    }
  }

  private getRememberMeValue(): boolean {
    return true;
  }

  async sendPasswordResetEmail(email: string): Promise<void> {
    console.log('Enviando e-mail de recuperação de senha para:', email);
    try {
      await sendPasswordResetEmail(this.auth, email); // ✅ this.auth
      console.log('E-mail de recuperação enviado.');
    } catch (error) {
      console.log('Erro ao enviar e-mail de recuperação:', error);
      this.globalErrorHandler.handleError(error as Error);
      this.errorNotification.showError('Erro ao enviar o e-mail de recuperação. Tente novamente.');
      throw error;
    }
  }

  async confirmPasswordReset(oobCode: string, newPassword: string): Promise<void> {
    console.log('Confirmando redefinição de senha com oobCode:', oobCode);
    try {
      await confirmPasswordReset(this.auth, oobCode, newPassword); // ✅ this.auth
      console.log('Senha redefinida com sucesso.');
    } catch (error) {
      console.log('Erro ao redefinir a senha:', error);
      this.globalErrorHandler.handleError(error as Error);
      this.errorNotification.showError('Erro ao redefinir a senha. Tente novamente.');
      throw error;
    }
  }

  async reauthenticateUser(password: string): Promise<void> {
    const user = this.auth.currentUser; // ✅ this.auth
    if (user && user.email) {
      const credential = EmailAuthProvider.credential(user.email, password);
      try {
        await reauthenticateWithCredential(user, credential);
        console.log('Reautenticação bem-sucedida.');
      } catch (error) {
        console.log('Erro ao reautenticar usuário:', error);
        this.globalErrorHandler.handleError(error as Error);
        this.errorNotification.showError('Erro ao reautenticar o usuário. Verifique a senha e tente novamente.');
        throw error;
      }
    } else {
      throw new Error('Usuário não autenticado');
    }
  }
}
