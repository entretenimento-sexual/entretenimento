// src/app/core/guards/user.owner.guard.ts
// Guard: garante que apenas o dono acesse /perfil/:id.
// - Não depende de AuthService legado. excluir totalmente o AuthService
// - Não exige emailVerified (perfil próprio deve abrir; gating fica por feature/UI).
import { Injectable, inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { defer, from, of, Observable } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';
import { GlobalErrorHandlerService } from '../../services/error-handler/global-error-handler.service';

@Injectable({ providedIn: 'root' })
export class UserOwnerGuard implements CanActivate {
  private readonly router = inject(Router);
  private readonly auth = inject(Auth);
  private readonly globalError = inject(GlobalErrorHandlerService);

  canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<boolean | UrlTree> {
    const routeId = route.paramMap.get('id');

    const toLogin = () =>
      this.router.createUrlTree(['/login'], { queryParams: { redirectTo: state.url } });

    const toDashboard = () =>
      this.router.createUrlTree(['/dashboard/principal']);

    return defer(() => from((this.auth as any).authStateReady?.() ?? Promise.resolve())).pipe(
      map(() => this.auth.currentUser ?? null),
      switchMap((u) => {
        if (!u) return of(toLogin());
        if (!routeId) return of(toDashboard());

        // ✅ Só o dono entra
        return of(u.uid === routeId ? true : toDashboard());
      }),
      catchError((err) => {
        try {
          (err as any).silent = true;
          (err as any).feature = 'user-owner-guard';
        } catch { }
        this.globalError.handleError(err);
        return of(toDashboard());
      }),
      take(1)
    );
  }
}
