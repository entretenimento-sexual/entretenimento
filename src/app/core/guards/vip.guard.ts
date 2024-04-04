//src\app\core\guards\vip.guard.ts
// src\app\core\guards\vip.guard.ts
import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { map, take, filter } from 'rxjs/operators';
import { UsuarioStateService } from '../services/autentication/usuario-state.service';

@Injectable({
  providedIn: 'root'
})
export class VipGuard implements CanActivate {
  constructor(
    private usuarioStateService: UsuarioStateService,
    private router: Router
  ) { }

  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean> | Promise<boolean> | boolean {
    return this.usuarioStateService.temAcessoVip().pipe(
      filter(user => !!user), // Garante que o user não seja nulo
      take(1), // Pega apenas o primeiro valor emitido para não ficar em uma subscrição infinita
      map(hasVipAccess => {
        if (!hasVipAccess) {
          this.router.navigate(['/subscription-plan']).then(() => {
            console.log('Acesso restrito a usuários VIP. Redirecionando para página de subscrição.');
          });
          return false;
        }
        return true;
      })
    );
  }
}
