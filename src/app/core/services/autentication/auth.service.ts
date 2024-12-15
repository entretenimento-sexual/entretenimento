// src/app/core/services/autentication/auth.service.ts
import { Injectable } from '@angular/core';
import { Observable, BehaviorSubject, firstValueFrom, switchMap, tap, of, catchError } from 'rxjs';
import { IUserDados } from '../../interfaces/iuser-dados';
import { getAuth, onAuthStateChanged, signOut, User } from 'firebase/auth';
import { UsuarioService } from '../user-profile/usuario.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { Store } from '@ngrx/store';
import { AppState } from '../../../store/states/app.state';
import { loginSuccess, logoutSuccess } from '../../../store/actions/actions.user/auth.actions';
import { Router } from '@angular/router';
import { getDatabase, ref, set } from 'firebase/database';
import { setCurrentUser } from 'src/app/store/actions/actions.user/user.actions';
import { FirestoreQueryService } from '../data-handling/firestore-query.service';

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
    private firestoreQuery: FirestoreQueryService,
    private globalErrorHandlerService: GlobalErrorHandlerService,
    private store: Store<AppState>
  ) {
    this.initAuthStateListener();
  }

  // Inicializa o listener de autenticação e recupera o estado do usuário.
  private initAuthStateListener(): void {
    new Observable<User | null>((observer) => {
      onAuthStateChanged(auth, (user) => {
        observer.next(user);
      });
    })
      .pipe(
        switchMap(user => {
          if (user) {
            return this.firestoreQuery.getUser(user.uid);
          } else {
            this.clearCurrentUser();
            return of(null);
          }
        }),
        tap(userData => {
          if (userData) {
            console.log('Usuário carregado no AuthService:', userData);
            this.userSubject.next(userData);
            localStorage.setItem('currentUser', JSON.stringify(userData));
            this.store.dispatch(loginSuccess({ user: userData }));
            this.store.dispatch(setCurrentUser({ user: userData }));

            // Configura o Realtime Database para indicar que o usuário está online
            const userStatusRef = ref(db, `status/${userData.uid}`);
            set(userStatusRef, { online: true, lastChanged: new Date().toISOString() })
              .then(() => {
                return this.usuarioService.updateUserOnlineStatus(userData.uid, true);
              })
              .then(() => {
                console.log('Status isOnline atualizado no Firestore para online.');
              })
              .catch(error => {
                console.error('Erro ao definir o status online:', error);
              });
          }
        }),
        catchError(error => {
          console.error('Erro ao recuperar estado de autenticação:', error);
          this.globalErrorHandlerService.handleError(error as Error);
          return of(null);
        })
      )
      .subscribe();
  }

  get currentUser(): IUserDados | null {
    return this.userSubject.value;
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
    this.store.dispatch(logoutSuccess());
    console.log('Estado de usuário limpo e sessão encerrada.');
  }

  setCurrentUser(userData: IUserDados): void {
    if (!userData || !userData.uid) {
      console.error('Dados de usuário inválidos fornecidos para setCurrentUser:', userData);
      return;
    }
    this.userSubject.next(userData);
    localStorage.setItem('currentUser', JSON.stringify(userData));
    console.log('Usuário definido e salvo no localStorage:', userData);
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
