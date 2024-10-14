//src\app\core\services\autentication\auth.service.ts
import { Injectable } from '@angular/core';
import { Observable, BehaviorSubject } from 'rxjs';
import { catchError, take } from 'rxjs/operators';
import { IUserDados } from '../../interfaces/iuser-dados';
import { getAuth } from 'firebase/auth';
import { UsuarioService } from '../usuario.service';
import { ErrorNotificationService } from '../error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { Store } from '@ngrx/store';
import { AppState } from '../../../store/states/app.state';
import { loginSuccess, logoutSuccess } from '../../../store/actions/auth.actions';
import { Router } from '@angular/router';

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
    private usuarioService: UsuarioService,
    private globalErrorHandlerService: GlobalErrorHandlerService,
    private errorNotificationService: ErrorNotificationService,
    private store: Store<AppState>
      ) { this.initAuthStateListener(); }

  // Inicia o ouvinte de mudança de autenticação manualmente
  private initAuthStateListener(): void {
    auth.onAuthStateChanged(user => {
      console.log('onAuthStateChanged user: ', user);
      if (user) {
        this.usuarioService.getUsuario(user.uid).pipe(catchError(error => {
          this.handleError(error);
          return [];
        })).subscribe(
          userData => {
            if (userData) {
              console.log('Usuario recuperado: ', userData);
              this.currentUserValue = userData;
              this.userSubject.next(userData);
              localStorage.setItem('currentUser', JSON.stringify(userData));
              console.log('Dispatching loginSuccess action with user data');
              this.store.dispatch(loginSuccess({ user: userData }));
            }
          }
        );
      } else {
        console.log('Nenhum usuário autenticado. Limpa estado local.');
        const storedUser = localStorage.getItem('currentUser');
        if (storedUser) {
          const parsedUser = JSON.parse(storedUser);
          this.setCurrentUser(parsedUser);
        }
      }
    });
  }

  isAuthenticated(): boolean {
    return !!this.currentUserValue;
  }

  getUserAuthenticated(): Observable<IUserDados | null> {
    return this.user$;
  }

  getLoggedUserUID(): string | null {
    return this.currentUserValue ? this.currentUserValue.uid : null;
  }

  setCurrentUser(userData: IUserDados): void {
    this.currentUserValue = userData;
    this.userSubject.next(userData);
  }

  // Limpa o estado do usuário (novo método)
  clearCurrentUser(): void {
    this.currentUserValue = null; // Zera o estado do usuário localmente
    this.userSubject.next(null); // Notifica todos os assinantes que o usuário foi resetado
    localStorage.removeItem('currentUser'); // Remove os dados do usuário do localStorage
    console.log('Estado de usuário limpo e sessão encerrada.');
  }

  logout(): void {
    auth.signOut().then(() => {
      this.clearCurrentUser();  // Limpa o estado do usuário
      this.store.dispatch(logoutSuccess());  // Dispara uma ação de logout
      this.router.navigate(['/login']);  // Redireciona para a página de login
    }).catch(error => this.handleError(error));
  }

  private handleError(error: any): void {
    let errorMessage = 'Ocorreu um erro ao processar a solicitação.';

    if (error.code === 'auth/user-not-found') {
      errorMessage = 'Usuário não encontrado. Verifique seu email.';
    } else if (error.code === 'auth/wrong-password') {
      errorMessage = 'Senha incorreta. Tente novamente.';
    } else if (error.code === 'auth/network-request-failed') {
      errorMessage = 'Erro de rede. Verifique sua conexão.';
    }

    this.globalErrorHandlerService.handleError(error);
    this.errorNotificationService.showError(errorMessage);
  }
}
