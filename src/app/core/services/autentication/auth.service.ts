//src\app\core\services\autentication\auth.service.ts
import { Injectable } from '@angular/core';
import { from, Observable, of, ReplaySubject } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { IUserDados } from '../../interfaces/iuser-dados';
import { Router } from '@angular/router';

import { getAuth, signOut, User, createUserWithEmailAndPassword, applyActionCode, signInWithEmailAndPassword } from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';

import { FirestoreService } from './firestore.service';
import { EmailVerificationService } from './email-verification.service';
import { PreRegisterServiceService } from './pre-register.service';

const auth = getAuth();

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  private userSubject = new ReplaySubject<IUserDados | null>(1);
  private currentUserValue: IUserDados | null = null;

  // Observable do usuário
  user$: Observable<IUserDados | null> = this.userSubject.asObservable();

  constructor(
    private router: Router,
    private firestoreService: FirestoreService,
    private emailVerificationService: EmailVerificationService,
    private preRegisterService: PreRegisterServiceService
  ) {
    this.initAuthStateListener();
  }

  // Inicia o ouvinte de mudança de autenticação
  private initAuthStateListener(): void {
    auth.onAuthStateChanged(user => {
      const userData = this.mapUserToUserDados(user);
      this.currentUserValue = userData; // Atualize o valor atual aqui
      this.userSubject.next(userData);
    });
  }

  // Mapeia o usuário do Firebase para o formato IUserDados
  private mapUserToUserDados(user: User | null): IUserDados | null {
    if (!user) return null;

    const now = new Date();
    const timestampNow = Timestamp.fromDate(now);

    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || null,
      photoURL: user.photoURL || null,
      role: 'animando',
      lastLoginDate: timestampNow,
      firstLogin: timestampNow,
      descricao: '',   // Valor padrão ou nulo
      facebook: '',    // Valor padrão ou nulo
      instagram: '',   // Valor padrão ou nulo
      buupe: '',
    };
  }

  // Registro de novo usuário
  async register(email: string, password: string, nickname: string = '', userPreferences: any = {}): Promise<void> {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      if (user) {
        this.emailVerificationService.sendEmailVerification(user, {
          url: 'http://localhost:4200/email-verified'
        });

        const currentUserData = this.mapUserToUserDados(user);

        console.log('Dados do usuário antes de salvar:', currentUserData); // Linha adicionada

        if (currentUserData) {
          currentUserData.nickname = nickname; // Aqui, adicionamos o apelido ao objeto currentUserData.
          await this.saveUserToFirestore(currentUserData);
          await this.preRegisterService.saveUserPreferences(userPreferences);
        } else {
          console.warn('currentUserData é null. Não é possível salvar preferências.');
        }

        console.log('Usuário registrado:', user);
      }
    } catch (error) {
      console.error('Erro ao registrar usuário:', error);
      throw error;
    }
  }

  async resendVerificationEmail(): Promise<void> {
    if (auth.currentUser) {
      try {
        await this.emailVerificationService.sendEmailVerification(auth.currentUser, {
          url: 'http://localhost:4200/email-verified'
        });
      } catch (error) {
        console.error('Erro ao reenviar o e-mail de verificação:', error);
        throw error;
      }
    } else {
      console.error('Nenhum usuário autenticado encontrado');
      throw new Error('Nenhum usuário autenticado encontrado');
    }
  }

  async saveUserToFirestore(user: IUserDados) {
    try {
      await this.firestoreService.saveUserDataAfterEmailVerification(user); // Use o método apropriado aqui
    } catch (error) {
      console.error('Erro ao salvar usuário no Firestore:', error);
      throw error;
    }
  }

  // Checa se o nickname existe
  async checkIfNicknameExists(nickname: string): Promise<boolean> {
    return this.firestoreService.checkIfNicknameExists(nickname);
  }

  // Desloga o usuário
  logout(): Observable<void> {
    return from(signOut(auth)).pipe(
      tap(() => {
        this.userSubject.next(null);
        console.log('Usuário deslogado com sucesso.');
      }),
      catchError(error => {
        console.error('Erro ao deslogar:', error);
        return of(undefined);
      })
    );
  }

  // Verifica se o usuário está autenticado
  isUserAuthenticated(): boolean {
    return !!this.currentUserValue;
  }

  // Retorna o usuário atual
  get currentUser(): IUserDados | null {
    return this.currentUserValue;
  }

  // Busca usuário pelo ID
  async getUserById(uid: string): Promise<IUserDados | null> {
    console.log("Chamando getUserById no AuthService com UID:", uid);
    const userData = await this.firestoreService.getUserById(uid);
    console.log('Dados recuperados do Firestore:', userData);
    return userData;
  }

  async login(email: string, password: string): Promise<IUserDados | null> {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      if (user) {
        console.log('Usuário logado com sucesso:', user);
        return this.mapUserToUserDados(user);
      } else {
        console.warn('Dados do usuário não encontrados após o login.');
        return null;
      }
    } catch (error) {
      console.error('Erro ao fazer login:', error);
      throw error;
    }
  }
}
