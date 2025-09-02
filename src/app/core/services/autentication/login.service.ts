// src/app/core/services/autentication/login.service.ts
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { sendPasswordResetEmail as sendPasswordResetEmailFn,
  getAuth, signInWithEmailAndPassword, sendPasswordResetEmail,
  confirmPasswordReset, setPersistence, browserLocalPersistence,
  browserSessionPersistence, EmailAuthProvider, Persistence,
  reauthenticateWithCredential
} from 'firebase/auth';
import { Router } from '@angular/router';

import { GeolocationTrackingService } from '../geolocation/geolocation-tracking.service';

import { IUserDados } from '../../interfaces/iuser-dados';
import { AuthService } from './auth.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';

// ✅ use o SDK Web do Firestore (coerente com o FirestoreService)
import { doc, Timestamp, updateDoc } from 'firebase/firestore';

import { FirestoreService } from '../data-handling/firestore.service';
import { FirestoreUserQueryService } from '../data-handling/firestore-user-query.service';
import { UsuarioService } from '../user-profile/usuario.service';

// 👇 garante app inicializado antes de pegar o auth (safe)
import { getApps, initializeApp } from 'firebase/app';
import { environment } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class LoginService {
  /** Instância do Auth do SDK Web (não depende de DI do AngularFire). */
  private auth = getAuth();

  constructor(
    private router: Router,
    private usuarioService: UsuarioService,
    private firestoreService: FirestoreService,
    private firestoreUserQuery: FirestoreUserQueryService,
    private authService: AuthService,
    private globalErrorHandler: GlobalErrorHandlerService,
    private errorNotification: ErrorNotificationService,
    private geoloc: GeolocationTrackingService,
  ) {
    // Evita o erro app/no-app se este serviço for instanciado antes do AppModule.
    if (!getApps().length) {
      initializeApp(environment.firebase);
    }
    this.auth = getAuth();
  }

  /**
   * Login por e-mail e senha.
   * - `rememberMe` é opcional: se você já chamou setSessionPersistence no componente, pode omitir.
   * - Fonte única de verdade: AuthService.setCurrentUser(userData). Sem dispatch duplo → evita loops.
   */
  async login(
    email: string,
    password: string,
    rememberMe?: boolean
  ): Promise<{ success: boolean; emailVerified?: boolean; user?: IUserDados }> {
    const db = this.firestoreService.getFirestoreInstance();
    console.log(`[LoginService] Tentativa de login: ${email}`);

    try {
      // Se o componente já definiu a persistência, pode omitir `rememberMe`.
      if (typeof rememberMe === 'boolean') {
        await this.setSessionPersistence(rememberMe ? browserLocalPersistence : browserSessionPersistence);
      }

      // Autentica
      const { user } = await signInWithEmailAndPassword(this.auth, email, password);
      if (!user) {
        console.warn('[LoginService] signIn não retornou usuário.');
        await this.authService.logout();
        this.errorNotification.showError('Credenciais inválidas.');
        return { success: false };
      }

      console.log('[LoginService] Login bem-sucedido:', user.uid);

      // Busca dados do Firestore (1x) usando o serviço coeso com cache/store
      const userData = await firstValueFrom(this.firestoreUserQuery.getUser(user.uid));
      if (!userData) {
        console.warn('[LoginService] Documento do usuário não encontrado no Firestore.');
        await this.authService.logout();
        this.errorNotification.showError('Usuário não encontrado no sistema.');
        return { success: false };
      }

      // ✅ Fonte única de verdade: deixa o AuthService cuidar do estado/NgRx/listeners
      await this.authService.setCurrentUser(userData as any);

      // 🛰️ liga o tracking automaticamente se o navegador já tem permissão concedida
      void this.geoloc.autoStartTracking(user.uid);

      // Atualiza lastLogin (SDK Web do Firestore)
      try {
        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, { lastLogin: Timestamp.fromDate(new Date()) });
      } catch (e) {
        // Não interrompe fluxo de login por causa de analítico
        console.debug('[LoginService] Falha ao atualizar lastLogin (não crítico):', e);
      }

      // Atualiza flag online (não bloqueante)
      try {
        // Se for Observable, não precisamos esperar:
        // void this.usuarioService.updateUserOnlineStatus(user.uid, true);
        const ret = (this.usuarioService as any)?.updateUserOnlineStatus?.(user.uid, true);
        if (ret?.toPromise) await ret.toPromise();
        else if (ret instanceof Promise) await ret;
      } catch (e) {
        console.debug('[LoginService] Falha ao atualizar isOnline (não crítico):', e);
      }

      // Regras de navegação
      if (!userData.nickname || !userData.gender) {
        this.router.navigate(['/finalizar-cadastro']);
      } else if (!user.emailVerified) {
        // Conta autenticada mas e-mail não verificado: devolve flag para o componente abrir modal
        return { success: true, emailVerified: false, user: userData };
      } else {
        this.router.navigate([`/perfil/${user.uid}`]);
      }

      return { success: true, emailVerified: user.emailVerified, user: userData };
    } catch (error: any) {
      // Mapeia alguns erros comuns para UX melhor
      const code = error?.code as string | undefined;
      let friendly = 'Erro ao realizar login. Tente novamente.';
      switch (code) {
        case 'auth/user-not-found':
          friendly = 'Usuário não encontrado. Verifique o e-mail inserido.';
          break;
        case 'auth/wrong-password':
          friendly = 'Senha incorreta. Tente novamente.';
          break;
        case 'auth/user-disabled':
          friendly = 'Este usuário foi desativado.';
          break;
        case 'auth/too-many-requests':
          friendly = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
          break;
      }
      console.error('[LoginService] Erro ao fazer login:', error);
      this.globalErrorHandler.handleError(error as Error);
      this.errorNotification.showError(friendly);

      // Garante sessão limpa em falhas no fluxo
      try { await this.authService.logout(); } catch { /* no-op */ }

      return { success: false };
    }
  }

  /** Pedir permissão por ação do usuário e iniciar o tracking (retorna true se começou). */
  async requestGeolocationOnce(): Promise<boolean> {
    const state = await this.geoloc.requestPermissionOnce(); // dispara o prompt
    const uid = this.auth.currentUser?.uid;
    if (uid && state === 'granted') {
      this.geoloc.startTracking(uid);
      return true;
    }
    return false;
  }

  /** Define a persistência da sessão. Pode ser chamada do componente antes do login. */
  async setSessionPersistence(persistence: Persistence): Promise<void> {
    try {
      await setPersistence(this.auth, persistence);
      console.log('[LoginService] Persistência de sessão definida.');
    } catch (error) {
      console.error('[LoginService] Erro ao definir persistência de sessão:', error);
      this.globalErrorHandler.handleError(error as Error);
      this.errorNotification.showError('Erro ao definir a persistência de sessão.');
      throw error;
    }
  }

  /** Envia e-mail de reset de senha. */
  async sendPasswordReset(email: string): Promise<void> {
    console.log('[LoginService] Enviando e-mail de recuperação para:', email);
    try {
      await sendPasswordResetEmailFn(this.auth, email);
      console.log('[LoginService] E-mail de recuperação enviado.');
    } catch (error) {
      console.error('[LoginService] Erro ao enviar e-mail de recuperação:', error);
      this.globalErrorHandler.handleError(error as Error);
      this.errorNotification.showError('Erro ao enviar o e-mail de recuperação. Tente novamente.');
      throw error;
    }
  }

  /** Alias de compatibilidade para código legado.
 *  Mantém `loginService.sendPasswordResetEmail(email)` funcionando.
 */
  async sendPasswordResetEmail(email: string): Promise<void> {
    return this.sendPasswordReset(email);
  }

  /** Confirma redefinição de senha (a partir do link com oobCode). */
  async confirmPasswordReset(oobCode: string, newPassword: string): Promise<void> {
    console.log('[LoginService] Confirmando redefinição de senha com oobCode:', oobCode);
    try {
      await confirmPasswordReset(this.auth, oobCode, newPassword);
      console.log('[LoginService] Senha redefinida com sucesso.');
    } catch (error) {
      console.error('[LoginService] Erro ao redefinir a senha:', error);
      this.globalErrorHandler.handleError(error as Error);
      this.errorNotification.showError('Erro ao redefinir a senha. Tente novamente.');
      throw error;
    }
  }

  /** Reautentica o usuário atual (útil antes de operações sensíveis). */
  async reauthenticateUser(password: string): Promise<void> {
    const user = this.auth.currentUser;
    if (!user || !user.email) {
      throw new Error('Usuário não autenticado');
    }

    try {
      const credential = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, credential);
      console.log('[LoginService] Reautenticação bem-sucedida.');
    } catch (error) {
      console.error('[LoginService] Erro ao reautenticar usuário:', error);
      this.globalErrorHandler.handleError(error as Error);
      this.errorNotification.showError('Erro ao reautenticar. Verifique a senha e tente novamente.');
      throw error;
    }
  }
}
