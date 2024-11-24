// src/app/core/services/autentication/auth.service.ts
import { Injectable } from '@angular/core';
import { Observable, BehaviorSubject, firstValueFrom } from 'rxjs';
import { IUserDados } from '../../interfaces/iuser-dados';
import { getAuth, onAuthStateChanged, signOut } from 'firebase/auth';
import { UsuarioService } from '../usuario.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { Store } from '@ngrx/store';
import { AppState } from '../../../store/states/app.state';
import { loginSuccess, logoutSuccess } from '../../../store/actions/actions.user/auth.actions';
import { Router } from '@angular/router';
import { getDatabase, ref, set } from 'firebase/database';
import { setCurrentUser } from 'src/app/store/actions/actions.user/user.actions';

const auth = getAuth();
const db = getDatabase();

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private userSubject = new BehaviorSubject<IUserDados | null>(null);
  user$: Observable<IUserDados | null> = this.userSubject.asObservable();

  constructor(
    private router: Router,
    private usuarioService: UsuarioService,
    private globalErrorHandlerService: GlobalErrorHandlerService,
    private store: Store<AppState>
  ) {
    this.initAuthStateListener();
  }

  // Inicializa o listener de autenticação e recupera o estado do usuário.
  private async initAuthStateListener(): Promise<void> {
    onAuthStateChanged(auth, async (user) => {
      console.log('onAuthStateChanged user: ', user);

      if (user) {
        try {
          const userData = await firstValueFrom(this.usuarioService.getUsuario(user.uid));

          if (userData) {
            console.log('Usuario recuperado: ', userData);
            this.userSubject.next(userData);
            localStorage.setItem('currentUser', JSON.stringify(userData));
            this.store.dispatch(loginSuccess({ user: userData }));
            this.store.dispatch(setCurrentUser({ user: userData }));

            // Configura o Realtime Database para indicar que o usuário está online
            const userStatusRef = ref(db, `status/${user.uid}`);
            try {
              await set(userStatusRef, { online: true, lastChanged: new Date().toISOString() });

              // Atualiza o status online do Firestore
              await this.usuarioService.updateUserOnlineStatus(user.uid, true);
              console.log('Status isOnline atualizado no Firestore para online.');
            } catch (error) {
              console.error('Erro ao definir o status online:', error);
            }
          }
        } catch (error) {
          this.globalErrorHandlerService.handleError(error as Error);
        }
      } else {
        console.log('Nenhum usuário autenticado. Limpa estado local.');
        this.clearCurrentUser();
      }
    });
  }

  private loadUserFromLocalStorage(): void {
    try {
      const storedUser = localStorage.getItem('currentUser');
      if (storedUser) {
        const parsedUser = JSON.parse(storedUser) as IUserDados;
        this.userSubject.next(parsedUser);
        console.log('Usuário carregado do localStorage: ', parsedUser);
      }
    } catch (error: any) {
      console.warn('Erro ao carregar o usuário do localStorage.', error);
      this.globalErrorHandlerService.handleError(error);
    }
  }

  isAuthenticated(): boolean {
    return this.userSubject.value !== null;
  }

  getLoggedUserUID(): string | null {
    return this.userSubject.value?.uid || null;
  }

  public logoutAndClearUser(): void {
    this.clearCurrentUser();
  }

  private clearCurrentUser(): void {
    this.userSubject.next(null);
    localStorage.removeItem('currentUser');
    console.log('Estado de usuário limpo e sessão encerrada.');
  }

  setCurrentUser(userData: IUserDados): void {
    this.userSubject.next(userData);
    localStorage.setItem('currentUser', JSON.stringify(userData));
    console.log('Usuário definido e salvo no localStorage:', userData);
    console.log('Estado do usuário foi atualizado no BehaviorSubject:', this.userSubject.value);
  }

  async logout(): Promise<void> {
    const userUID = this.getLoggedUserUID();
    if (userUID) {
      try {
        // Atualiza o status do usuário para offline antes de efetuar o logout
        await this.usuarioService.updateUserOnlineStatus(userUID, false);
        console.log('Status isOnline atualizado no Firestore para offline.');

        // Efetuar logout no Firebase
        await signOut(auth);
        console.log('Logout do Firebase realizado com sucesso.');

        // Limpa o estado do usuário e navega para a página de login
        this.clearCurrentUser();
        this.store.dispatch(logoutSuccess());
        console.log('Logout realizado com sucesso e estado do usuário atualizado.');

        await this.router.navigate(['/login']);
      } catch (error) {
        console.error('Erro ao fazer logout:', error);
        this.globalErrorHandlerService.handleError(error as Error);
      }
    } else {
      console.warn('UID do usuário não encontrado. Não é possível efetuar logout.');
    }
  }
}
