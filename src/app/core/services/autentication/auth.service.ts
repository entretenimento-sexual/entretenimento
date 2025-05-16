// src/app/core/services/autentication/auth.service.ts
import { Injectable, Injector } from '@angular/core';
import { Observable, BehaviorSubject, switchMap, tap, of, catchError, from } from 'rxjs';
import { distinctUntilChanged, map, shareReplay } from 'rxjs/operators';
import { IUserDados } from '../../interfaces/iuser-dados';
import { getAuth, onAuthStateChanged, signOut, User } from 'firebase/auth';
import { UsuarioService } from '../user-profile/usuario.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { Store } from '@ngrx/store';
import { AppState } from '../../../store/states/app.state';
import { loginSuccess, logoutSuccess } from '../../../store/actions/actions.user/auth.actions';
import { Router } from '@angular/router';
import { getDatabase, onDisconnect, ref, serverTimestamp, set } from 'firebase/database';
import { setCurrentUser } from 'src/app/store/actions/actions.user/user.actions';
import { FirestoreUserQueryService } from '../data-handling/firestore-user-query.service';
import { CacheService } from '../general/cache/cache.service';

const auth = getAuth();
const db = getDatabase();

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private userSubject = new BehaviorSubject<IUserDados | null>(null);
  private cachedUid$: Observable<string | null> | null = null;
  user$: Observable<IUserDados | null> = this.userSubject.asObservable();

  constructor(
    private router: Router,
    private injector: Injector,
    private firestoreUserQuery: FirestoreUserQueryService,
    private globalErrorHandlerService: GlobalErrorHandlerService,
    private cacheService: CacheService,
    private store: Store<AppState>
  ) {
    console.log('[AuthService] Inicializando AuthService...');
    this.initAuthStateListener();
  }

  // Método para obter o UsuarioService apenas quando necessário
  private get usuarioService(): UsuarioService {
    return this.injector.get(UsuarioService);
  }

  private updateUserOnlineStatusRealtime(uid: string): void {
    const userStatusRef = ref(db, `status/${uid}`);

    from(set(userStatusRef, { online: true, lastChanged: serverTimestamp() }))
      .pipe(
        tap(() => {
          console.log('[AuthService] Status online atualizado no Realtime Database.');
          onDisconnect(userStatusRef).set({ online: false, lastChanged: serverTimestamp() });
        }),
        switchMap(() => this.usuarioService.updateUserOnlineStatus(uid, true)),
        tap(() => console.log('[AuthService] Status isOnline atualizado no Firestore para online.')),
        catchError(error => {
          console.error('[AuthService] Erro ao definir status online:', error);
          this.globalErrorHandlerService.handleError(error);
          return of(null);
        })
      )
      .subscribe();
  }

  // Chamando a função quando o usuário se autenticar
  private initAuthStateListener(): void {
    new Observable<User | null>((observer) => {
      onAuthStateChanged(auth, (user) => observer.next(user));
    })
      .pipe(
        switchMap((user) => {
          if (!user) {
            console.log('[AuthService] Nenhum usuário autenticado, limpando estado.');
            this.clearCurrentUser();
            return of(null);
          }

          // Primeiro, verifica se o usuário já está no BehaviorSubject
          const cachedUser = this.userSubject.value;
          if (cachedUser?.uid === user.uid) {
            console.log(`[AuthService] Usuário já carregado no estado:`, cachedUser);
            return of(cachedUser);
          }

          // Segundo, verifica no CacheService
          return this.cacheService.get<IUserDados>('currentUser').pipe(
            switchMap((cachedData) => {
              if (cachedData?.uid === user.uid) {
                console.log('[AuthService] Usuário recuperado do cache:', cachedData);
                return of(cachedData);
              }

              // Terceiro, verifica no LocalStorage
              const localUserData = localStorage.getItem('currentUser');
              if (localUserData) {
                const parsedUser = JSON.parse(localUserData) as IUserDados;
                if (parsedUser?.uid === user.uid) {
                  console.log('[AuthService] Usuário recuperado do localStorage:', parsedUser);
                  return of(parsedUser);
                }
              }

              // Se o usuário não estiver no cache ou localStorage, busca no Firestore
              console.log(`[AuthService] Buscando usuário do Firestore (UID: ${user.uid})...`);
              return this.firestoreUserQuery.getUser(user.uid);
            })
          );
        }),
        tap((userData) => {
          if (userData) {
            console.log('[AuthService] Definindo usuário autenticado:', userData);

            // Atualiza os estados e cache para evitar buscas repetitivas
            this.userSubject.next(userData);
            localStorage.setItem('currentUser', JSON.stringify(userData));
            this.cacheService.set('currentUser', userData, 300000); // 5 minutos de cache

            // Atualiza o estado global via NgRx
            this.store.dispatch(loginSuccess({ user: userData }));
            this.store.dispatch(setCurrentUser({ user: userData }));

            // Atualiza status online no Realtime Database e Firestore
            this.updateUserOnlineStatusRealtime(userData.uid);
          }
        }),
        catchError((error) => {
          console.error('[AuthService] Erro ao recuperar estado de autenticação:', error);
          this.globalErrorHandlerService.handleError(error);
          return of(null);
        }),
        shareReplay(1) // Evita múltiplas assinaturas desnecessárias
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
        if (parsedUser?.uid) {
        this.userSubject.next(parsedUser);
        console.log('Usuário carregado do localStorage: ', parsedUser);
        }
      }
    } catch (error: any) {
      console.log('Erro ao carregar o usuário do localStorage.', error);
      this.globalErrorHandlerService.handleError(error);
    }
  }

  isAuthenticated(): boolean {
    return this.userSubject.value !== null;
  }

  getLoggedUserUID$(): Observable<string | null> {
    if (!this.cachedUid$) {
      this.cachedUid$ = this.cacheService.get<string>('currentUserUid').pipe(
        distinctUntilChanged(),
        switchMap(cachedUid => {
          if (cachedUid) {
            console.log('[AuthService] UID encontrado no cache:', cachedUid);
            return of(cachedUid);
          }
          const authUser = auth.currentUser;
          if (authUser?.uid) {
            console.log('[AuthService] UID encontrado no Firebase Auth:', authUser.uid);
            this.cacheService.set('currentUserUid', authUser.uid, 300000);
            return of(authUser.uid);
          }
          console.log('[AuthService] UID não encontrado em nenhuma fonte.');
          return of(null);
        }),
        tap(uid => {
          if (!uid) {
            console.log('[AuthService] UID ainda não está disponível.');
          }
        }),
        catchError(error => {
          console.error('[AuthService] Erro ao obter UID:', error);
          this.globalErrorHandlerService.handleError(error);
          return of(null);
        }),
        shareReplay(1) // Compartilha o último valor emitido para evitar múltiplas chamadas
      );
    }

    return this.cachedUid$;
  }
  public logoutAndClearUser(): void {
    this.clearCurrentUser();
  }

  private clearCurrentUser(): void {
    this.userSubject.next(null);
    localStorage.removeItem('currentUser');
    this.cachedUid$ = null;
    this.store.dispatch(logoutSuccess());
    console.log('Estado de usuário limpo e sessão encerrada.');
  }

  setCurrentUser(userData: IUserDados): void {
    if (!userData || !userData.uid) {
      console.error('Dados de usuário inválidos fornecidos para setCurrentUser:', userData);
      return;
    }
    if (JSON.stringify(this.currentUser) !== JSON.stringify(userData)) {
      this.userSubject.next(userData);
      localStorage.setItem('currentUser', JSON.stringify(userData));
      this.cacheService.set('currentUserUid', userData.uid, 300000);

      this.store.dispatch(setCurrentUser({ user: userData }));
      console.log('[AuthService] Usuário definido e salvo no cache e localStorage:', userData);
    } else {
      console.log('[AuthService] Nenhuma mudança detectada no usuário, evitando gravação redundante.');
    }
  }

  logout(): Observable<void> {
    return this.getLoggedUserUID$().pipe(
      switchMap((uid) => {
        if (!uid) {
          console.log('[AuthService] UID não encontrado. Não é possível efetuar logout.');
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

