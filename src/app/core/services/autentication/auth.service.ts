// src\app\core\services\autentication\auth.service.ts
import { Injectable } from '@angular/core';
import { Observable, BehaviorSubject, firstValueFrom } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { IUserDados } from '../../interfaces/iuser-dados';
import { getAuth, onAuthStateChanged, signOut } from 'firebase/auth';
import { UsuarioService } from '../usuario.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { Store } from '@ngrx/store';
import { AppState } from '../../../store/states/app.state';
import { loginSuccess, logoutSuccess, userOffline } from '../../../store/actions/actions.user/auth.actions';
import { Router } from '@angular/router';
import { onDisconnect, getDatabase, ref, set } from 'firebase/database';

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


   //Inicializa o listener de autenticação e recupera o estado do usuário,
   //tentando obter dados do localStorage caso o usuário esteja desconectado.
  private initAuthStateListener(): void {
    onAuthStateChanged(auth, async (user) => {
      console.log('onAuthStateChanged user: ', user);

      if (user) {
        try {
          const userData = await this.usuarioService.getUsuario(user.uid).pipe(
            catchError((error) => {
              this.globalErrorHandlerService.handleError(error);
              return [];
            })
          ).toPromise();

          if (userData) {
            console.log('Usuario recuperado: ', userData);
            this.userSubject.next(userData);
            localStorage.setItem('currentUser', JSON.stringify(userData));
            this.store.dispatch(loginSuccess({ user: userData }));

            // Configura o Realtime Database para gerenciar a desconexão inesperada
            const userStatusRef = ref(db, `status/${user.uid}`);
            await set(userStatusRef, { online: true, lastChanged: new Date().toISOString() });

            // Se ocorrer desconexão inesperada, define o status como offline
            onDisconnect(userStatusRef).set({ online: false, lastChanged: new Date().toISOString() }).then(() => {
              // Após marcar como offline no Realtime Database, também atualiza no Firestore
              this.usuarioService.updateUserOnlineStatus(user.uid, false).subscribe({
                next: () => {
                  console.log('Status isOnline atualizado no Firestore após desconexão inesperada.');
                  this.store.dispatch(userOffline({ uid: user.uid }));
                },

                error: (error) => this.globalErrorHandlerService.handleError(error)
              });
            }).catch((error) => {
              this.globalErrorHandlerService.handleError(error as Error);
            });
          }
        } catch (error) {
          this.globalErrorHandlerService.handleError(error as Error);
        }
      } else {
        console.log('Nenhum usuário autenticado. Limpa estado local.');
        this.loadUserFromLocalStorage();
      }
    });
  }

  // Tenta carregar o usuário autenticado do localStorage.
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

  //Verifica se o usuário está autenticado com base no estado atual do BehaviorSubject.
  isAuthenticated(): boolean {
    return this.userSubject.value !== null;
  }

  //Retorna o ID do usuário logado, caso exista.
  getLoggedUserUID(): string | null {
    return this.userSubject.value?.uid || null;
  }

  //Atualiza o usuário atual e o armazena no localStorage.
  setCurrentUser(userData: IUserDados): void {
    this.userSubject.next(userData);
    localStorage.setItem('currentUser', JSON.stringify(userData));
  }

  //Método público para limpar o estado do usuário e realizar logout
  public logoutAndClearUser(): void {
    this.clearCurrentUser();
  }

  private clearCurrentUser(): void {
    this.userSubject.next(null);
    localStorage.removeItem('currentUser');
    console.log('Estado de usuário limpo e sessão encerrada.');
  }

// Atualização do status online no Firestore antes do logout
  async logout(): Promise<void> {
    const userUID = this.getLoggedUserUID();
    if (userUID) {
      try {
        await signOut(auth);
        await firstValueFrom(this.usuarioService.updateUserOnlineStatus(userUID, false));
        this.clearCurrentUser();
        this.store.dispatch(logoutSuccess());
        await this.router.navigate(['/login']);
      } catch (error) {
        this.globalErrorHandlerService.handleError(error as Error);
      }
    }
  }
}
