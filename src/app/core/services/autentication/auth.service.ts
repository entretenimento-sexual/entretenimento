// src\app\core\services\autentication\auth.service.ts
import { Injectable } from '@angular/core';
import { from, Observable, of, ReplaySubject } from 'rxjs';
import { catchError, tap, first } from 'rxjs/operators';
import { IUserDados } from '../../interfaces/iuser-dados';
import { Router } from '@angular/router';
import { getAuth, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, UserCredential, sendPasswordResetEmail, confirmPasswordReset } from 'firebase/auth';
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
  private userSubject = new ReplaySubject<IUserDados | null>(1);
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
    auth.onAuthStateChanged(user => {
      if (user) {
        this.usuarioService.getUsuario(user.uid).subscribe(userData => {
          this.currentUserValue = userData;
          this.userSubject.next(userData);
        }, error => {
          console.error('Erro ao buscar dados do usuário:', error);
          this.currentUserValue = null;
          this.userSubject.next(null);
        });
      } else {
        this.currentUserValue = null;
        this.userSubject.next(null);
      }
    });
  }

  // Obtém o usuário autenticado
  getUserAuthenticated(): Observable<IUserDados | null> {
    return this.user$.pipe(first());
  }

  // Obtém o UID do usuário logado
  getLoggedUserUID(): string | null {
    return this.currentUserValue ? this.currentUserValue.uid : null;
  }

  async checkIfNicknameExists(nickname: string): Promise<boolean> {
    return this.firestoreService.checkIfNicknameExists(nickname);
  }

  // Registro de usuário
  async register(userRegistrationData: IUserRegistrationData, password: string): Promise<void> {
    let userCredential: UserCredential | null = null;

    const nicknameExists = await this.checkIfNicknameExists(userRegistrationData.nickname);
    if (nicknameExists) {
      throw new Error('O apelido já está em uso.');
    }

    try {
      userCredential = await createUserWithEmailAndPassword(getAuth(), userRegistrationData.email, password);
      const user = userCredential.user;
      if (!user) throw new Error('Falha ao criar usuário.');

      userRegistrationData.uid = user.uid;
      userRegistrationData.emailVerified = false;
      userRegistrationData.isSubscriber = false;
      userRegistrationData.firstLogin = Timestamp.fromDate(new Date());

      // Adicionar localização geográfica ao registro (opcional)
      try {
        const location = await this.geolocationService.getCurrentLocation();
        userRegistrationData.latitude = location.latitude;
        userRegistrationData.longitude = location.longitude;
      } catch (error) {
        console.warn('Erro ao obter localização: ', error);
      }

      await this.firestoreService.saveInitialUserData(user.uid, userRegistrationData);

    } catch (error) {
      console.error('Erro durante o registro:', error);
      if (userCredential && userCredential.user) {
        await userCredential.user.delete();
        console.log('Conta excluída devido a erro no registro.');
      }
      throw error;
    }
  }

  // Login de usuário
  async login(email: string, password: string): Promise<IUserDados | null | undefined> {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      if (user) {
        return this.usuarioService.getUsuario(user.uid).pipe(first()).toPromise();
      }
      return null;
    } catch (error) {
      console.error('Erro ao fazer login:', error);
      throw error;
    }
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

  // Função para confirmar a redefinição de senha
  async confirmPasswordReset(oobCode: string, newPassword: string): Promise<void> {
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
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (error) {
      console.error('Erro ao enviar e-mail de recuperação:', error);
      throw error;
    }
  }
}
