// src\app\core\guards\auth.guard.ts
import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { AuthService } from '../services/autentication/auth.service'; // Ajuste o caminho se necessário

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {

  constructor(private authService: AuthService, private router: Router) { }

  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot): Observable<boolean> | Promise<boolean> | boolean {

    const isAuthenticated = this.authService.isUserAuthenticated(); // Supondo que o seu serviço de autenticação tenha um método isAuthenticated()

    if (isAuthenticated) {
      return true;
    } else {
      this.router.navigate(['/authentication/login-component']); // Ajuste para a rota de login correta
      return false;
    }
  }
}
