// src/app/core/guards/email-verified.guard.ts
// Não esqueça os comentáros explicativos sobre o propósito desse guard.
import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree, ActivatedRouteSnapshot } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { defer, from, map, of } from 'rxjs';
import { environment } from 'src/environments/environment';

function routeAllowsUnverified(route: ActivatedRouteSnapshot): boolean {
  let cursor: ActivatedRouteSnapshot | null = route;
  while (cursor) {
    if (cursor.data?.['allowUnverified'] === true) return true;
    cursor = cursor.parent ?? null;
  }
  return false;
}

export const emailVerifiedGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);
  const auth = inject(Auth);

  if (environment?.features?.enforceEmailVerified === false) {
    return of(true);
  }

  // ✅ Espera o ready, decide por currentUser
  return defer(() => from((auth as any).authStateReady?.() ?? Promise.resolve())).pipe(
    map(() => {
      const user = auth.currentUser;
      if (!user) {
        return router.createUrlTree(['/login'], { queryParams: { redirectTo: state.url } });
      }
      if (user.emailVerified) return true;

      if (routeAllowsUnverified(route)) return true;

      const allowed = ['/post-verification/action', '/__/auth/action', '/register/welcome'];
      if (allowed.some(p => state.url.startsWith(p))) return true;

      return router.createUrlTree(['/register/welcome'], { queryParams: { redirectTo: state.url } });
    })
  );
};
