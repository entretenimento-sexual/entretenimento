// src/app/core/guards/auth.guard.ts
import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { from, Observable, of } from 'rxjs';
import { AuthService } from '../services/autentication/auth.service';
import { map, take, catchError, switchMap } from 'rxjs/operators';
import { getAuth } from 'firebase/auth';

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
    return this.authService.user$.pipe(
      take(1),
      switchMap((user) => {
        if (user) {
          // Validação direta no Firebase
          return this.validateUserToken().pipe(
            map((isValid) => {
              if (!isValid) {
                this.authService.logout();
                this.router.navigate(['/login']);
                return false;
              }
              return true;
            })
          );
        } else {
          // Restaura o usuário do localStorage
          const storedUser = localStorage.getItem('currentUser');
          if (storedUser) {
            const parsedUser = JSON.parse(storedUser);
            if (parsedUser) {
              this.authService.setCurrentUser(parsedUser);
              return this.validateUserToken();
            }
          }
          this.router.navigate(['/login']);
          return of(false);
        }
      }),
      catchError(() => {
        this.router.navigate(['/login']);
        return of(false);
      })
    );
  }

  /**
   * Valida o usuário diretamente no Firebase Authentication.
   * @param uid UID do usuário para validação.
   */
  private validateUserToken(): Observable<boolean> {
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (currentUser) {
      return from(currentUser.getIdTokenResult()).pipe(
        map(() => true), // Token válido
        catchError(() => of(false)) // Token inválido ou expirado
      );
    } else {
      return of(false); // Usuário não está autenticado
    }
  }
}
