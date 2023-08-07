// src\app\guards\extase.guard.ts
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { AuthService } from '../core/services/autentication/auth.service'; // Ajuste o caminho se necessário
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ExtaseGuard implements CanActivate {

  constructor(private authService: AuthService, private router: Router) { }

  async canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot): Promise<boolean> {

    const hasProfile = await this.authService.hasExtaseProfile();

    if (hasProfile) { // supondo que este método verifique o perfil extase
      return true;
    } else {
      this.router.navigate(['/error']); // ou qualquer outra página de erro
      return false;
    }
  }
}
