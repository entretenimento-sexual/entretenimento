// src\app\core\guards\subscription.guard.ts
import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { map, take, tap } from 'rxjs/operators';
import { UsuarioStateService } from '../services/autentication/usuario-state.service';

@Injectable({
  providedIn: 'root'
})
export class SubscriptionGuard implements CanActivate {
  constructor(private usuarioStateService: UsuarioStateService,
              private router: Router) { }

  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot): Observable<boolean> | Promise<boolean> | boolean {
    return this.usuarioStateService.user$.pipe(
      take(1),
      map(user => !!user && user.isSubscriber), // Verifica se o usuário existe e se é assinante
      tap(isSubscriber => {
        if (!isSubscriber) {
          // Se não for assinante, redirecione para uma página informando sobre a necessidade de assinatura
          // ou para a página de planos de assinatura.
          this.router.navigate(['/alguma-rota-para-informacao-de-assinatura-ou-login']);
        }
      })
    );
  }
}
