// src\app\core\services\autentication\auth.service.ts
import { Injectable } from '@angular/core';
import { from, Observable, of, BehaviorSubject } from 'rxjs';
import { catchError, tap, first, take } from 'rxjs/operators';
import { IUserDados } from '../../interfaces/iuser-dados';
import { Router } from '@angular/router';
import {
  getAuth, signOut, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, UserCredential, sendPasswordResetEmail,
  confirmPasswordReset, sendEmailVerification, User
} from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';

import { FirestoreService } from './firestore.service';
import { UsuarioService } from '../usuario.service';
import { UserProfileService } from '../user-profile/user-profile.service';
import { GeolocationService } from '../geolocation/geolocation.service';
import { IUserRegistrationData } from '../../interfaces/iuser-registration-data';

const auth = getAuth();

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private userSubject = new BehaviorSubject<IUserDados | null>(null); // Mudança para BehaviorSubject
  private currentUserValue: IUserDados | null = null;

  // Observable do usuário
  user$: Observable<IUserDados | null> = this.userSubject.asObservable();

  constructor(
    private router: Router,
    private firestoreService: FirestoreService,
    private usuarioService: UsuarioService,
    private userProfileService: UserProfileService,
    private geolocationService: GeolocationService
  ) {
    this.initAuthStateListener();
  }

  // Inicia o ouvinte de mudança de autenticação
  private initAuthStateListener(): void {
    console.log("initAuthStateListener chamado");
    auth.onAuthStateChanged(user => {
      if (user) {
        console.log(`Usuário autenticado: ${user.uid}`);
        this.usuarioService.getUsuario(user.uid).pipe(take(1)).subscribe(userData => { // Usa take(1) para evitar múltiplas assinaturas
          if (userData) {
            console.log('Dados do usuário carregados', userData);
            this.currentUserValue = userData;  // Atualiza a variável de estado
            this.userSubject.next(userData);  // Atualiza o BehaviorSubject com os dados do usuário
          } else {
            console.log('Usuário não encontrado no Firestore, definindo como null');
            this.currentUserValue = null;
            this.userSubject.next(null);
          }
        }, error => {
          console.error('Erro ao buscar dados do usuário:', error);
          this.currentUserValue = null;
          this.userSubject.next(null);
        });
      } else {
        console.log('Nenhum usuário autenticado');
        this.currentUserValue = null;
        this.userSubject.next(null);
      }
    });
  }

  // Retorna diretamente o estado de autenticação baseado em currentUserValue
  isAuthenticated(): boolean {
    console.log('Verificando se o usuário está autenticado:', !!this.currentUserValue);
    return !!this.currentUserValue;  // Verifica se currentUserValue está definido
  }

  // Obtém o usuário autenticado
  getUserAuthenticated(): Observable<IUserDados | null> {
    console.log('getUserAuthenticated chamado');
    return this.user$; // Retorna o BehaviorSubject como observable
  }

  // Obtém o UID do usuário logado
  getLoggedUserUID(): string | null {
    console.log('getLoggedUserUID chamado');
    return this.currentUserValue ? this.currentUserValue.uid : null;
  }

  async checkIfNicknameExists(nickname: string): Promise<boolean> {
    console.log(`checkIfNicknameExists chamado para o apelido: ${nickname}`);
    return this.firestoreService.checkIfNicknameExists(nickname);
  }

  // Registro de usuário
  async register(userRegistrationData: IUserRegistrationData, password: string): Promise<void> {
    console.log('register chamado', userRegistrationData);
    let userCredential: UserCredential | null = null;

    const nicknameExists = await this.checkIfNicknameExists(userRegistrationData.nickname);
    if (nicknameExists) {
      console.error('O apelido já está em uso');
      throw new Error('O apelido já está em uso.');
    }

    try {
      userCredential = await createUserWithEmailAndPassword(getAuth(), userRegistrationData.email, password);
      const user = userCredential.user;
      if (!user) throw new Error('Falha ao criar usuário.');

      console.log('Usuário criado', user);

      // Envia o e-mail de verificação imediatamente após o registro
      await this.sendEmailVerification(user);

      userRegistrationData.uid = user.uid;
      userRegistrationData.emailVerified = false;
      userRegistrationData.isSubscriber = false;
      userRegistrationData.firstLogin = Timestamp.fromDate(new Date());

      // Adicionar localização geográfica ao registro (opcional)
      try {
        const location = await this.geolocationService.getCurrentLocation();
        userRegistrationData.latitude = location.latitude;
        userRegistrationData.longitude = location.longitude;
        console.log('Localização adicionada ao registro', location);
      } catch (error) {
        console.warn('Erro ao obter localização: ', error);
      }

      await this.firestoreService.saveInitialUserData(user.uid, userRegistrationData);
      console.log('Dados iniciais do usuário salvos no Firestore');

    } catch (error) {
      console.error('Erro durante o registro:', error);
      if (userCredential && userCredential.user) {
        await userCredential.user.delete();
        console.log('Conta excluída devido a erro no registro.');
      }
      throw error;
    }
  }

  // Envia o e-mail de verificação
  async sendEmailVerification(user: User): Promise<void> {
    console.log('sendEmailVerification chamado');
    try {
      await sendEmailVerification(user);
      console.log('E-mail de verificação enviado.');
    } catch (error) {
      console.error('Erro ao enviar e-mail de verificação:', error);
    }
  }

  // Login de usuário
  async login(email: string, password: string): Promise<boolean> {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      if (user) {
        console.log('Login bem-sucedido');
        const userData = await this.usuarioService.getUsuario(user.uid).pipe(first()).toPromise();

        // Verifique se userData é definido
        if (userData) {
          this.currentUserValue = userData;  // Atualiza o estado de autenticação
          this.userSubject.next(userData);
        } else {
          this.currentUserValue = null;
          this.userSubject.next(null);
        }

        this.router.navigate([`/perfil/${user.uid}`]);
        return true;  // Login bem-sucedido
      } else {
        console.log('Falha no login');
        this.currentUserValue = null;
        this.userSubject.next(null);
        return false;
      }
    } catch (error) {
      console.error('Erro ao fazer login:', error);
      this.currentUserValue = null;
      this.userSubject.next(null);
      return false;
    }
  }

  // Desloga o usuário
  logout(): Observable<void> {
    return from(signOut(auth)).pipe(
      tap(() => {
        this.currentUserValue = null;
        this.userSubject.next(null);
        console.log('Usuário deslogado com sucesso.');
      }),
      catchError(error => {
        console.error('Erro ao deslogar:', error);
        return of(undefined);
      })
    );
  }

  // Função para confirmar a redefinição de senha
  async confirmPasswordReset(oobCode: string, newPassword: string): Promise<void> {
    console.log('confirmPasswordReset chamado');
    try {
      await confirmPasswordReset(auth, oobCode, newPassword);
      console.log('Senha redefinida com sucesso.');
    } catch (error) {
      console.error('Erro ao redefinir a senha:', error);
      throw error;
    }
  }

  // Função para enviar o e-mail de recuperação de senha
  async sendPasswordResetEmail(email: string): Promise<void> {
    console.log('sendPasswordResetEmail chamado para email:', email);
    try {
      await sendPasswordResetEmail(auth, email);
      console.log('E-mail de recuperação enviado.');
    } catch (error) {
      console.error('Erro ao enviar e-mail de recuperação:', error);
      throw error;
    }
  }
}
