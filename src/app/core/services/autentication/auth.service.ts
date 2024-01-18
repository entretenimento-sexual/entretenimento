//src\app\core\services\autentication\auth.service.ts
import { Injectable } from '@angular/core';
import { from, Observable, of, ReplaySubject } from 'rxjs';
import { catchError, tap, switchMap, first } from 'rxjs/operators';
import { IUserDados } from '../../interfaces/iuser-dados';
import { Router } from '@angular/router';

import { getAuth, signOut, User, createUserWithEmailAndPassword, applyActionCode, signInWithEmailAndPassword } from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';

import { FirestoreService } from './firestore.service';
import { EmailVerificationService } from './email-verification.service';
import { PreRegisterServiceService } from './pre-register.service';
import { UsuarioService } from '../usuario.service';

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
    private usuarioService: UsuarioService,
    private preRegisterService: PreRegisterServiceService
  ) {
    this.initAuthStateListener();
  }

  // Inicia o ouvinte de mudança de autenticação
  private initAuthStateListener(): void {
    auth.onAuthStateChanged(user => {
      if (user) {
        // Se um usuário estiver autenticado, obtemos os dados completos do usuário
        this.usuarioService.getUsuario(user.uid).subscribe(userData => {
          // Atualiza o valor atual e emite os dados através do userSubject
          this.currentUserValue = userData;
          this.userSubject.next(userData);
        }, error => {
          // Em caso de erro, registra o erro e define os valores como null
          console.error('Erro ao buscar dados do usuário:', error);
          this.currentUserValue = null;
          this.userSubject.next(null);
        });
      } else {
        // Se não houver usuário autenticado, define os valores como null
        this.currentUserValue = null;
        this.userSubject.next(null);
      }
    });
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

        // Obtenha os dados do usuário mapeados do UsuarioService
        // Use switchMap para lidar com operações assíncronas
        this.usuarioService.getUsuario(user.uid).subscribe(async currentUserData => {
          if (currentUserData) {
            currentUserData.nickname = nickname;
            await this.saveUserToFirestore(currentUserData);
            await this.preRegisterService.saveUserPreferences(userPreferences);
            console.log('Usuário registrado e preferências salvas.');
          } else {
            console.warn('currentUserData é null. Não é possível salvar preferências.');
          }
        }, error => {
          console.error('Erro ao registrar usuário:', error);
        });
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

  async login(email: string, password: string): Promise<IUserDados | null | undefined> {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      if (user) {
        console.log('Usuário logado com sucesso:', user);
        return this.usuarioService.getUsuario(user.uid).pipe(
          first()
        ).toPromise();
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
