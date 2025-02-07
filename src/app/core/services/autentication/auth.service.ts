// src/app/core/services/autentication/auth.service.ts
import { Injectable, Injector } from '@angular/core';
import { Observable, BehaviorSubject, switchMap, tap, of, catchError, from } from 'rxjs';
import { map, mapTo } from 'rxjs/operators';
import { IUserDados } from '../../interfaces/iuser-dados';
import { browserSessionPersistence, getAuth, onAuthStateChanged, setPersistence, signOut, User } from 'firebase/auth';
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

  private updateUserOnlineStatusRealtime(uid: string): void {
    const userStatusRef = ref(db, `status/${uid}`);

    // Define online
    set(userStatusRef, { online: true, lastChanged: serverTimestamp() })
      .then(() => {
        console.log('[AuthService] Status online atualizado no Realtime Database.');

        // Configura para marcar como offline automaticamente ao perder conexão
        onDisconnect(userStatusRef).set({ online: false, lastChanged: serverTimestamp() });
      })
      .catch(error => {
        console.error('[AuthService] Erro ao definir status online no Realtime Database:', error);
      });

    // Atualiza no Firestore também para manter a consistência
    // Atualiza o status online no Firestore (correção do erro 1️⃣)
    this.usuarioService.updateUserOnlineStatus(uid, true).subscribe({
      next: () => console.log('[AuthService] Status isOnline atualizado no Firestore para online.'),
      error: (error: Error) => console.error('[AuthService] Erro ao definir isOnline no Firestore:', error)
    });
  }

  // Chamando a função quando o usuário se autenticar
  private initAuthStateListener(): void {
    new Observable<User | null>((observer) => {
      onAuthStateChanged(auth, (user) => {
        observer.next(user);
      });
    })
      .pipe(
        switchMap(user => {
          if (!user) {
            console.log('[AuthService] Nenhum usuário autenticado, limpando estado.');
            this.clearCurrentUser();
            return of(null);
          }

          if (this.currentUser) {
            console.log('[AuthService] Usuário já carregado:', this.currentUser);
            return of(this.currentUser);
          }

          console.log(`[AuthService] Usuário autenticado detectado (UID: ${user.uid}). Recuperando dados...`);
          return this.firestoreUserQuery.getUser(user.uid);
        }),
        tap(userData => {
          if (userData) {
            console.log('Usuário carregado no AuthService:', userData);
            this.userSubject.next(userData);
            localStorage.setItem('currentUser', JSON.stringify(userData));
            this.store.dispatch(loginSuccess({ user: userData }));
            this.store.dispatch(setCurrentUser({ user: userData }));
            this.cacheService.set('currentUserUid', userData.uid, 300000);

            // Atualiza status online no Realtime Database e Firestore
            this.updateUserOnlineStatusRealtime(userData.uid);
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
        if (parsedUser?.uid) {
        this.userSubject.next(parsedUser);
        console.log('Usuário carregado do localStorage: ', parsedUser);
        }
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
    return (this.cacheService.get<string>('currentUserUid')).pipe(
      switchMap(cachedUid => {
        if (cachedUid) {
          console.log('[AuthService] UID encontrado no cache:', cachedUid);
          return of(cachedUid);
        }

        const currentUser = this.userSubject.value;
        if (currentUser?.uid) {
          console.log('[AuthService] UID encontrado no estado interno:', currentUser.uid);
          this.cacheService.set('currentUserUid', currentUser.uid, 300000); // 🔍 Atualiza o cache
          return of(currentUser.uid);
        }

        const authUser = getAuth().currentUser;
        if (authUser?.uid) {
          console.log('[AuthService] UID encontrado no Firebase Auth:', authUser.uid);
          this.cacheService.set('currentUserUid', authUser.uid, 300000); // 🔍 Atualiza o cache
          return of(authUser.uid);
        }

        console.log('[AuthService] UID não encontrado em nenhuma fonte.');
        return of(null);
      }),
      tap(uid => {
        if (!uid) {
          console.log('[AuthService] UID ainda não está disponível. Retentando...');
        }
      }),
      catchError(error => {
        console.error('[AuthService] Erro ao obter UID:', error);
        this.globalErrorHandlerService.handleError(error);
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
    this.cacheService.set('currentUserUid', userData.uid, 300000);

    this.store.dispatch(setCurrentUser({ user: userData }));

    console.log('[AuthService] Usuário definido e salvo no cache e localStorage:', userData);
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

