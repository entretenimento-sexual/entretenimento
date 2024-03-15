// src\app\core\guards\basic.guard.ts
import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { filter, map, take } from 'rxjs/operators';
import { UsuarioStateService } from '../services/autentication/usuario-state.service';

@Injectable({
  providedIn: 'root'
})
export class BasicGuard implements CanActivate {
  constructor(
    private usuarioStateService: UsuarioStateService,
    private router: Router
  ) { }

  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean> | Promise<boolean> | boolean {
    console.log('BasicGuard: canActivate iniciado');

    return this.usuarioStateService.temAcessoBasico().pipe(
      filter(user => !!user),
      take(1),
      map(hasBasicAccess => {
          if (!hasBasicAccess) {
          // O redirecionamento é realizado somente se o usuário não tem o acesso necessário
          this.router.navigate(['/subscription-plan']).then(() => {
            console.log('Redirecionamento para página de plano de subscrição por falta de acesso.');
          });
          return false;
        }
        return true;
      })
    );
  }
}
