// src/app/core/guards/email-verified.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree, ActivatedRouteSnapshot } from '@angular/router';
import { Observable, of } from 'rxjs';
import { map, take } from 'rxjs/operators';
import { FIREBASE_AUTH } from '../firebase/firebase.tokens';
import { onAuthStateChanged, type Auth, type User } from 'firebase/auth';
import { environment } from 'src/environments/environment';

function routeAllowsUnverified(route: ActivatedRouteSnapshot): boolean {
  let cursor: ActivatedRouteSnapshot | null = route;
  while (cursor) {
    if (cursor.data?.['allowUnverified'] === true) return true;
    cursor = cursor.parent ?? null;
  }
  return false;
}

export const emailVerifiedGuard: CanActivateFn = (route, state): Observable<boolean | UrlTree> => {
  const router = inject(Router);
  const auth = inject(FIREBASE_AUTH) as Auth;

  if (environment?.features?.enforceEmailVerified === false) {
    return of(true);
  }

  const auth$ = new Observable<User | null>((obs) => {
    const unsub = onAuthStateChanged(
      auth,
      (u) => { obs.next(u); obs.complete(); },
      () => { obs.next(null); obs.complete(); }
    );
    return () => unsub();
  });

  return auth$.pipe(
    take(1),
    map((user) => {
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
