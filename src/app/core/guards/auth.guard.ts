// src\app\core\guards\auth.guard.ts
import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { Observable, map, take, tap } from 'rxjs';
import { AuthService } from '../services/autentication/auth.service';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {

  constructor(private authService: AuthService, private router: Router) { }

  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot): Observable<boolean> {
    console.log('Iniciando verificação de autenticação: ', Date.now()); //linha 17
    return this.authService.user$.pipe(
      take(1),  // pega apenas o primeiro valor emitido
      tap(user => {
        if (!user) {
          this.router.navigate(['/login']);
        }
      }),
      map(user => !!user)
    );
  }
}
