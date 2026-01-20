// src/app/core/guards/vip.guard.ts
// Não esqueça os comentáros explicativos sobre o propósito desse guard.
import { Injectable } from '@angular/core';
import { CanActivate, Router, RouterStateSnapshot } from '@angular/router';
import { combineLatest } from 'rxjs';
import { filter, map, take } from 'rxjs/operators';
import { AccessControlService } from '../services/autentication/auth/access-control.service';
import { CurrentUserStoreService } from '../services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from '../services/error-handler/error-notification.service';

@Injectable({ providedIn: 'root' })
export class VipGuard implements CanActivate {
  constructor(
    private readonly access: AccessControlService,
    private readonly currentUser: CurrentUserStoreService,
    private readonly toast: ErrorNotificationService,
    private readonly router: Router
  ) { }

  canActivate(_: any, state: RouterStateSnapshot) {
    const ok$ = this.access.hasAtLeast$('vip').pipe(take(1));
    const user$ = this.currentUser.user$.pipe(filter(u => u !== undefined), take(1));

    return combineLatest([ok$, user$]).pipe(
      map(([ok, user]) => {
        if (ok) return true;

        this.toast.showError('Acesso exclusivo para usuários VIP.');

        if (!user) {
          return this.router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
        }

        return this.router.createUrlTree(
          ['/subscription-plan'],
          { queryParams: { need: 'vip', from: state.url } }
        );
      })
    );
  }
}
