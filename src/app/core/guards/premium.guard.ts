// src\app\core\guards\premium.guard.ts
import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { map, take, filter } from 'rxjs/operators';
import { UsuarioStateService } from '../services/autentication/usuario-state.service';

@Injectable({
  providedIn: 'root'
})
export class PremiumGuard implements CanActivate {
  constructor(
    private usuarioStateService: UsuarioStateService,
    private router: Router
  ) { }

  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean> | Promise<boolean> | boolean {
    return this.usuarioStateService.temAcessoPremium().pipe(
      filter(user => !!user), // Garante que o user não seja nulo
      take(1), // Pega apenas o primeiro valor emitido para não ficar em uma subscrição infinita
      map(hasPremiumAccess => {
        if (!hasPremiumAccess) {
            this.router.navigate(['/subscription-plan']).then(() => {
            console.log('Acesso restrito a usuários Premium. Redirecionando para página de subscrição.');
          });
          return false;
        }
        return true;
      })
    );
  }
}
