// src/app/core/guards/access-guard/vip.guard.ts
// Guard VIP: permite acesso apenas para usuários VIP.
// Mesmas boas práticas do PremiumGuard.
import { Injectable } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivate,
  GuardResult,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { combineLatest, Observable, of } from 'rxjs';
import { catchError, filter, map, take } from 'rxjs/operators';

import { AccessControlService } from '../../services/autentication/auth/access-control.service';
import { CurrentUserStoreService } from '../../services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from '../../services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../services/error-handler/global-error-handler.service';

@Injectable({ providedIn: 'root' })
export class VipGuard implements CanActivate {
  private lastToastAt = 0;
  private lastToastKey = '';
  private readonly TOAST_COOLDOWN_MS = 2500;

  constructor(
    private readonly access: AccessControlService,
    private readonly currentUser: CurrentUserStoreService,
    private readonly toast: ErrorNotificationService,
    private readonly router: Router,
    private readonly geh: GlobalErrorHandlerService
  ) { }

  canActivate(
    _route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<GuardResult> {
    const ok$ = this.access.hasAtLeast$('vip').pipe(take(1));
    const user$ = this.currentUser.user$.pipe(
      filter((u): u is any => u !== undefined),
      take(1)
    );

    return combineLatest([ok$, user$]).pipe(
      map(([ok, user]): GuardResult => {
        if (ok) return true;

        this.tryToastOnce(`vip:${state.url}`, 'Acesso exclusivo para usuários VIP.');

        if (!user) {
          return this.router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
        }

        return this.router.createUrlTree(['/subscription-plan'], {
          queryParams: { need: 'vip', from: state.url },
        });
      }),
      catchError((err): Observable<GuardResult> => {
        try { this.geh.handleError(err); } catch { }

        const tree: UrlTree = this.router.createUrlTree(['/login'], {
          queryParams: { redirect: state.url, reason: 'guard_error' },
        });

        return of(tree);
      })
    );
  }

  private tryToastOnce(key: string, msg: string): void {
    const now = Date.now();
    const sameKey = this.lastToastKey === key;

    if (sameKey && now - this.lastToastAt < this.TOAST_COOLDOWN_MS) return;

    this.lastToastKey = key;
    this.lastToastAt = now;
    this.toast.showError(msg);
  }
}
