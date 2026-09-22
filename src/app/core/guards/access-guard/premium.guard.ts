// src/app/core/guards/access-guard/premium.guard.ts
// Guard Premium: permite acesso apenas para usuários Premium ou VIP.
//
// Boas práticas:
// - One-shot: take(1) (guard conclui rápido)
// - Fail-safe: catchError -> redireciona com segurança e registra no GlobalErrorHandler
// - Evita spam de toast com throttle simples (singleton)
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
import { ApplicationErrorService } from '../../services/error-handler/application-error.service';

@Injectable({ providedIn: 'root' })
export class PremiumGuard implements CanActivate {
  // throttle simples para não duplicar toast em reavaliações de guard
  private lastToastAt = 0;
  private lastToastKey = '';
  private readonly TOAST_COOLDOWN_MS = 2500;

  constructor(
    private readonly access: AccessControlService,
    private readonly currentUser: CurrentUserStoreService,
    private readonly toast: ErrorNotificationService,
    private readonly router: Router,
    private readonly applicationError: ApplicationErrorService
  ) { }

  canActivate(
    _route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<GuardResult> {
    // 1) checa permissão premium+
    const ok$ = this.access.hasAtLeast$('premium').pipe(take(1));

    // 2) resolve usuário (null|user), ignorando 'undefined' inicial
    const user$ = this.currentUser.user$.pipe(
      filter((u): u is any => u !== undefined),
      take(1)
    );

    return combineLatest([ok$, user$]).pipe(
      map(([ok, user]): GuardResult => {
        if (ok) return true;

        // feedback com throttle
        this.tryToastOnce(`premium:${state.url}`, 'Este recurso é exclusivo para assinantes Premium ou VIP.');

        // não logado → login (com redirect)
        if (!user) {
          return this.router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
        }

        // logado sem nível suficiente → planos (com CTA)
        return this.router.createUrlTree(['/subscription-plan'], {
          queryParams: { need: 'premium', from: state.url },
        });
      }),
      catchError((err): Observable<GuardResult> => {
        // Guard não deve quebrar navegação; registra e falha seguro
        try {
          this.applicationError.report(err, {
            feature: 'access-guard',
            operation: 'canActivatePremium',
            fallbackMessage: 'Não foi possível validar seu acesso agora.',
            presentation: { surface: 'none', severity: 'error' },
            metadata: {
              scope: 'PremiumGuard',
              requiredTier: 'premium',
            },
          });
        } catch { }

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
