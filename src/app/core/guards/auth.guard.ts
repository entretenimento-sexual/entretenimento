// src/app/core/guards/auth.guard.ts
import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { Observable, map, take, tap, catchError, of } from 'rxjs';
import { AuthService } from '../services/autentication/auth.service';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {

  constructor(
    private authService: AuthService,
    private router: Router
  ) { }

  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot): Observable<boolean> {
    console.log('Iniciando verificação de autenticação: ', Date.now());
    return this.authService.user$.pipe(
      take(1),
      tap(user => {
        if (!user) {
          this.router.navigate(['/login']);
        }
      }),
      map(user => !!user),
      catchError(error => {
        // Aqui substituímos a chamada para o errorHandler por um log de erro
        console.error('Erro durante a verificação de autenticação:', error);
        this.router.navigate(['/login']);
        return of(false);
      })
    );
  }
}
