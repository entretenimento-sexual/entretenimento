// src\app\core\guards\user.owner.guard.ts
import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, RouterStateSnapshot } from '@angular/router';
import { Observable } from 'rxjs';
import { map, take } from 'rxjs/operators';
import { AuthService } from '../services/autentication/auth.service';

@Injectable({
  providedIn: 'root'
})
export class UserOwnerGuard implements CanActivate {
  constructor(private authService: AuthService,
    private router: Router) { }

  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot): Observable<boolean> | Promise<boolean> | boolean {
    const userId = next.paramMap.get('id'); // Obtém o ID do usuário a partir da URL

    return this.authService.user$.pipe(
      take(1),
      map(user => {
        const isOwner = user?.uid === userId; // Compara o ID do usuário autenticado com o ID da URL
        const isEmailVerified = user?.emailVerified; // Verifica se o e-mail está verificado

        if (!isOwner || !isEmailVerified) {
          this.router.navigate(['/verify-email']); // Redireciona para a página de verificação se o e-mail não for verificado
          return false;
        }
        return true;
      })
    );
  }
}
