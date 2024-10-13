// src\app\core\guards\auth-redirect.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/autentication/auth.service';
import { map } from 'rxjs/operators';

export const authRedirectGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.user$.pipe(
    map(user => {
      if (user) {
        // Se o usuário estiver autenticado, redireciona para a página principal
        //router.navigate(['/dashboard/principal']);
        return false; // Bloqueia o acesso à página de login
      }
      return true; // Permite o acesso se não estiver autenticado
    })
  );
};
