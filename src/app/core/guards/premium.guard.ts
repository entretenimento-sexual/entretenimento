// src/app/core/guards/premium.guard.ts
// Não esqueça os comentáros explicativos sobre o propósito desse guard.
import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree, RouterStateSnapshot } from '@angular/router';
import { combineLatest, of } from 'rxjs';
import { filter, map, take } from 'rxjs/operators';
import { AccessControlService } from '../services/autentication/auth/access-control.service';
import { CurrentUserStoreService } from '../services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from '../services/error-handler/error-notification.service';

@Injectable({ providedIn: 'root' })
export class PremiumGuard implements CanActivate {
  constructor(
    private readonly access: AccessControlService,
    private readonly currentUser: CurrentUserStoreService,
    private readonly toast: ErrorNotificationService,
    private readonly router: Router
  ) { }

  canActivate(_: any, state: RouterStateSnapshot) {
    // 1) checa permissão premium+
    const ok$ = this.access.hasAtLeast$('premium').pipe(take(1));

    // 2) resolve usuário (null|user), ignorando 'undefined' inicial
    const user$ = this.currentUser.user$.pipe(
      filter(u => u !== undefined),
      take(1)
    );

    return combineLatest([ok$, user$]).pipe(
      map(([ok, user]) => {
        if (ok) return true;

        // feedback
        this.toast.showError('Este recurso é exclusivo para assinantes Premium ou VIP.');

        // não logado → login (com redirect)
        if (!user) {
          return this.router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
        }

        // logado sem nível suficiente → planos (com CTA)
        return this.router.createUrlTree(
          ['/subscription-plan'],
          { queryParams: { need: 'premium', from: state.url } }
        );
      })
    );
  }
}
