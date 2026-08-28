// src/app/core/guards/ownership-guard/user.owner.guard.ts
// Guard: garante que apenas o dono acesse /perfil/:uid ou compat legada /perfil/:id.
//
// Regras:
// - exige sessão autenticada
// - NÃO exige emailVerified
// - NÃO exige profileCompleted
// - se não for o dono, redireciona para /dashboard/principal
//
// Motivo:
// - perfil próprio deve continuar acessível
// - o gating fino fica por feature/UI e guards específicos

import { Injectable, inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivate,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { Observable, combineLatest, of } from 'rxjs';
import { catchError, filter, map, take } from 'rxjs/operators';

import { AccessControlService } from '../../services/autentication/auth/access-control.service';
import { GlobalErrorHandlerService } from '../../services/error-handler/global-error-handler.service';
import { guardLog, isResolvedAccessState } from '../_shared-guard/guard-utils';

@Injectable({ providedIn: 'root' })
export class UserOwnerGuard implements CanActivate {
  private readonly router = inject(Router);
  private readonly access = inject(AccessControlService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean | UrlTree> {
    // Aceita o padrão novo (:uid) e o legado (:id)
    const routeId = route.paramMap.get('uid') ?? route.paramMap.get('id');

    const toLogin = () =>
      this.router.createUrlTree(['/login'], {
        queryParams: { redirectTo: state.url },
      });

    const toDashboard = () =>
      this.router.createUrlTree(['/dashboard/principal']);

    return combineLatest([
      this.access.ready$,
      this.access.authUid$,
      this.access.appUser$,
    ]).pipe(
      filter(([ready, authUid, appUser]) => {
        return ready === true && isResolvedAccessState(authUid, appUser);
      }),
      take(1),

      map(([_, authUid]) => {
        guardLog('owner', 'routeId:', routeId, 'authUid:', authUid, 'url:', state.url);

        if (!authUid) return toLogin();
        if (!routeId) return toDashboard();

        return authUid === routeId ? true : toDashboard();
      }),

      catchError((err) => {
        try {
          (err as any).silent = true;
          (err as any).feature = 'user-owner-guard';
          this.globalError.handleError(err);
        } catch {}

        return of(toDashboard());
      })
    );
  }
}
