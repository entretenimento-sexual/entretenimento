// src/app/core/services/autentication/auth.service.ts
import { Injectable, Injector } from '@angular/core';
import { Observable, BehaviorSubject, switchMap, tap, of, catchError, from, map } from 'rxjs';
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
import { FirestoreUserQueryService } from '../data-handling/firestore-user-query.service';
import { CacheService } from '../general/cache.service';

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
    private injector: Injector,
    private firestoreUserQuery: FirestoreUserQueryService,
    private globalErrorHandlerService: GlobalErrorHandlerService,
    private cacheService: CacheService,
    private store: Store<AppState>
  ) {
    this.initAuthStateListener();
  }

  // Método para obter o UsuarioService apenas quando necessário
  private get usuarioService(): UsuarioService {
    return this.injector.get(UsuarioService);
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
            return this.firestoreUserQuery.getUser(user.uid);
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

  getLoggedUserUID$(): Observable<string | null> {
    return of(this.cacheService.get<string>('currentUserUid')).pipe(
      switchMap(cachedUid => {
        if (cachedUid) {
          console.log('[AuthService] UID encontrado no cache:', cachedUid);
          return of(cachedUid); // UID encontrado no cache
        }

        // Busca no BehaviorSubject
        const currentUser = this.userSubject.value;
        if (currentUser?.uid) {
          console.log('[AuthService] UID encontrado no estado interno:', currentUser.uid);
          this.cacheService.set('currentUserUid', currentUser.uid, 300000); // Atualiza cache
          return of(currentUser.uid);
        }

        // Busca no Firebase Auth
        const authUser = getAuth().currentUser;
        if (authUser?.uid) {
          console.log('[AuthService] UID encontrado no Firebase Auth:', authUser.uid);
          this.cacheService.set('currentUserUid', authUser.uid, 300000); // Atualiza cache
          return of(authUser.uid);
        }

        // Caso nenhuma das fontes contenha o UID
        console.warn('[AuthService] UID não encontrado em nenhuma fonte.');
        return of(null);
      }),
      catchError(error => {
        console.error('[AuthService] Erro ao obter UID:', error);
        this.globalErrorHandlerService.handleError(error); // Tratamento global de erros
        return of(null);
      })
    );
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

  logout(): Observable<void> {
    return this.getLoggedUserUID$().pipe(
      switchMap((uid) => {
        if (!uid) {
          console.warn('[AuthService] UID não encontrado. Não é possível efetuar logout.');
          return of(void 0);
        }

        // Atualizar o status online do usuário para offline
        return this.usuarioService.updateUserOnlineStatus(uid, false).pipe(
          tap(() => console.log('Status isOnline atualizado no Firestore para offline.')),
          switchMap(() => from(signOut(auth))), // Efetuar logout no Firebase
          tap(() => {
            console.log('Logout do Firebase realizado com sucesso.');
            this.clearCurrentUser(); // Limpar estado local e no Store
            this.store.dispatch(logoutSuccess()); // Disparar ação de logout no Store
            console.log('Logout realizado com sucesso e estado do usuário atualizado.');
          }),
          switchMap(() => from(this.router.navigate(['/login']))), // Navegar para a página de login
          map(() => void 0),
          catchError((error) => {
            console.error('Erro ao fazer logout:', error);
            this.globalErrorHandlerService.handleError(error as Error);
            return of(void 0);
          })
        );
      })
    );
  }
}
