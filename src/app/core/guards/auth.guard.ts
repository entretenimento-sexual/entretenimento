// src/app/core/guards/auth.guard.ts
import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { from, Observable, of } from 'rxjs';
import { AuthService } from '../services/autentication/auth.service';
import { map, take, catchError, switchMap } from 'rxjs/operators';
import { getAuth, User } from 'firebase/auth';

@Injectable({
  providedIn: 'root',
})
export class AuthGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private router: Router
  ) { }

  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean> {
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (currentUser) {
      // Verifica se o usuário existe no Firebase e se o e-mail está verificado
      return from(currentUser.reload()).pipe(
        map(() => {
          if (!currentUser.emailVerified) {
            // Redireciona para a página de boas-vindas se o e-mail não foi verificado
            this.router.navigate(['/welcome']);
            return false;
          }
          return true; // Permite acesso à rota
        }),
        catchError(() => {
          this.router.navigate(['/login']); // Redireciona para login em caso de erro
          return of(false);
        })
      );
    } else {
      // Caso o usuário não esteja autenticado, redireciona para o login
      this.router.navigate(['/login'], { queryParams: { returnUrl: state.url } });
      return of(false);
    }
  }
}
