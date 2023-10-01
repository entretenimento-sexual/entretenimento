// src\app\core\guards\auth-check.guard.ts
import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, Router } from '@angular/router';
import { AuthService } from 'src/app/core/services/autentication/auth.service';

@Injectable({
  providedIn: 'root'
})
export class AuthCheckGuard implements CanActivate {

  constructor(private authService: AuthService, private router: Router) { }

  async canActivate(route: ActivatedRouteSnapshot): Promise<boolean> {
    const user = this.authService.currentUser;

    if (!user) {
      this.router.navigateByUrl('/login');
      return false;
    }

    const userData = await this.authService.getUserById(user.uid);

    if (!userData) {
      this.router.navigateByUrl('/error');  // Redirecionar para página de erro ou outra rota relevante.
      return false;
    }

    const expectedRole = route.data['expectedRole'];
    if (expectedRole && userData.role !== expectedRole) {
      this.router.navigateByUrl('/access-denied');  // Redirecionar para página de acesso negado.
      return false;
    }

    return true;
  }
}
