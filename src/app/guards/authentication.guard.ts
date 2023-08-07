// src\app\guards\authentication.guard.ts
import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { AuthService } from '../core/services/autentication/auth.service'; // ajuste o caminho conforme necessário

@Injectable({
  providedIn: 'root'
})
export class AuthenticationGuard implements CanActivate {

  constructor(private authService: AuthService, private router: Router) { }

  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {

    const isAuthenticated = this.authService.isUserAuthenticated(); // lógica para verificar se o usuário está autenticado, usando o AuthService

    if (isAuthenticated) {
      return true;
    } else {
      this.router.navigate(['/login']); // redirecione para a página de login ou qualquer outra rota adequada
      return false;
    }
  }
}
