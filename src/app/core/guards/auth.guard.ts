// src\app\core\guards\auth.guard.ts
import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { Observable, map, take, tap, catchError, of } from 'rxjs';
import { AuthService } from '../services/autentication/auth.service';
import { PhotoErrorHandlerService } from 'src/app/photo/services-photo/photo-error-handler.service';


@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {

  constructor(
    private authService: AuthService,
    private router: Router,
    private errorHandler: PhotoErrorHandlerService
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
        this.errorHandler.handleError(error);
        this.router.navigate(['/login']);
        return of(false);
      })
    );
  }
}
