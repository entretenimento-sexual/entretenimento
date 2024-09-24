// src\app\core\services\autentication\auth.service.ts
import { Injectable } from '@angular/core';
import { from, Observable, of, BehaviorSubject } from 'rxjs';
import { catchError, tap, first, take } from 'rxjs/operators';
import { IUserDados } from '../../interfaces/iuser-dados';
import { Router } from '@angular/router';
import {
  getAuth, signOut, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, UserCredential, sendPasswordResetEmail,
  confirmPasswordReset, sendEmailVerification, User,
  setPersistence,
  browserLocalPersistence
} from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';

import { FirestoreService } from './firestore.service';
import { UsuarioService } from '../usuario.service';
import { GeolocationService } from '../geolocation/geolocation.service';
import { IUserRegistrationData } from '../../interfaces/iuser-registration-data';

const auth = getAuth();

@Injectable({
  providedIn: 'root'
})

export class AuthService {
  private userSubject = new BehaviorSubject<IUserDados | null>(null);
  private currentUserValue: IUserDados | null = null;
  user$: Observable<IUserDados | null> = this.userSubject.asObservable();

  constructor(
    private router: Router,
    private firestoreService: FirestoreService,
    private usuarioService: UsuarioService,
    private geolocationService: GeolocationService
  ) { this.initAuthStateListener(); }

  // Inicia o ouvinte de mudança de autenticação manualmente
  private initAuthStateListener(): void {
    console.log("initAuthStateListener chamado");
    auth.onAuthStateChanged(user => {
      if (user) {
        console.log(`Usuário autenticado detectado: ${user.uid}`);
        this.usuarioService.getUsuario(user.uid).pipe(take(1)).subscribe(
          userData => {
            if (userData) {
              this.currentUserValue = userData;
              this.userSubject.next(userData);
              localStorage.setItem('currentUser', JSON.stringify(userData));
            }
          },
          error => {
            console.error('Erro ao buscar dados do usuário no Firestore:', error);
          }
        );
      } else {
        // Se o Firebase não retornar o estado do usuário, tenta restaurar do localStorage
        const storedUser = localStorage.getItem('currentUser');
        if (storedUser) {
          const parsedUser = JSON.parse(storedUser);
          this.setCurrentUser(parsedUser);
        }
      }
    });
  }

  // Retorna diretamente o estado de autenticação baseado em currentUserValue
  isAuthenticated(): boolean {
    const isAuthenticated = !!this.currentUserValue;
    console.log('Verificando se o usuário está autenticado:', isAuthenticated);
    return isAuthenticated;
  }

  // Obtém o usuário autenticado
  getUserAuthenticated(): Observable<IUserDados | null> {
    console.log('getUserAuthenticated chamado');
    return this.user$;
  }

  // Obtém o UID do usuário logado
  getLoggedUserUID(): string | null {
    console.log('getLoggedUserUID chamado');
    const uid = this.currentUserValue ? this.currentUserValue.uid : null;
    console.log('UID do usuário logado:', uid);
    return uid;
  }

  setCurrentUser(userData: IUserDados): void {
    this.currentUserValue = userData;
    this.userSubject.next(userData);
  }

  // Verifica se o nickname já existe
  async checkIfNicknameExists(nickname: string): Promise<boolean> {
    console.log(`checkIfNicknameExists chamado para o apelido: ${nickname}`);
    const exists = await this.firestoreService.checkIfNicknameExists(nickname);
    console.log(`Nickname existe: ${exists}`);
    return exists;
  }

  // Registro de usuário
  async register(userRegistrationData: IUserRegistrationData, password: string): Promise<void> {
    console.log('Registro iniciado para o usuário:', userRegistrationData);

    let userCredential: UserCredential | null = null;

    const nicknameExists = await this.checkIfNicknameExists(userRegistrationData.nickname);
    if (nicknameExists) {
      console.error('O apelido já está em uso:', userRegistrationData.nickname);
      throw new Error('O apelido já está em uso.');
    }

    try {
      userCredential = await createUserWithEmailAndPassword(getAuth(), userRegistrationData.email, password);
      const user = userCredential.user;
      if (!user) throw new Error('Falha ao criar usuário.');

      console.log('Usuário criado com sucesso:', user);
      await this.sendEmailVerification(user);

      userRegistrationData.uid = user.uid;
      userRegistrationData.emailVerified = false;
      userRegistrationData.isSubscriber = false;
      userRegistrationData.firstLogin = Timestamp.fromDate(new Date());

      try {
        const location = await this.geolocationService.getCurrentLocation();
        userRegistrationData.latitude = location.latitude;
        userRegistrationData.longitude = location.longitude;
        console.log('Localização adicionada ao registro:', location);
      } catch (error) {
        console.warn('Erro ao obter localização:', error);
      }

      await this.firestoreService.saveInitialUserData(user.uid, userRegistrationData);
      console.log('Dados iniciais do usuário salvos no Firestore');

    } catch (error) {
      console.error('Erro durante o registro:', error);
      if (userCredential && userCredential.user) {
        console.log('Tentando excluir a conta devido a erro no registro.');
        await userCredential.user.delete();
        console.log('Conta excluída com sucesso.');
      }
      throw error;
    }
  }

  // Envia o e-mail de verificação
  async sendEmailVerification(user: User): Promise<void> {
    console.log('Enviando e-mail de verificação para o usuário:', user.uid);
    try {
      await sendEmailVerification(user);
      console.log('E-mail de verificação enviado.');
    } catch (error) {
      console.error('Erro ao enviar e-mail de verificação:', error);
      throw error;
    }
  }

  // Login de usuário
  async login(email: string, password: string): Promise<boolean> {
    console.log(`Tentativa de login para o email: ${email}`);
    try {
      // Definir a persistência como local (mantém o usuário autenticado mesmo após fechar o navegador)
      await setPersistence(auth, browserLocalPersistence);
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      if (user) {
        console.log('Login bem-sucedido:', user.uid);
        const userData = await this.usuarioService.getUsuario(user.uid).pipe(first()).toPromise();

        if (userData) {
          this.currentUserValue = userData;
          this.userSubject.next(userData);
          console.log('Dados do usuário carregados após login:', userData);
        } else {
          console.log('Dados do usuário não encontrados no Firestore após login.');
          this.currentUserValue = null;
          this.userSubject.next(null);
        }

        this.router.navigate([`/perfil/${user.uid}`]);
        return true;
      } else {
        console.error('Falha no login: usuário não retornado.');
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

  // Desloga o usuário e limpa os dados do localStorage
  logout(): Observable<void> {
    console.log('Iniciando logout...');
    return from(signOut(auth)).pipe(
      tap(() => {
        console.log('Usuário deslogado com sucesso.');
        this.currentUserValue = null;  // Certifique-se de limpar o estado do usuário
        this.userSubject.next(null);   // Notifique os assinantes de que o usuário foi deslogado
        localStorage.removeItem('currentUser'); // Limpar o localStorage
      }),
      catchError(error => {
        console.error('Erro ao deslogar:', error);
        return of(undefined);
      })
    );
  }

  // Função para confirmar a redefinição de senha
  async confirmPasswordReset(oobCode: string, newPassword: string): Promise<void> {
    console.log('confirmPasswordReset chamado com oobCode:', oobCode);
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
    console.log('Enviando e-mail de recuperação de senha para:', email);
    try {
      await sendPasswordResetEmail(auth, email);
      console.log('E-mail de recuperação enviado.');
    } catch (error) {
      console.error('Erro ao enviar e-mail de recuperação:', error);
      throw error;
    }
  }
}

