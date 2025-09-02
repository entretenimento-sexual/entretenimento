// src/app/core/guards/auth.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Auth, authState } from '@angular/fire/auth';
import { from, of, Observable } from 'rxjs';
import { map, take, switchMap } from 'rxjs/operators';

export const authGuard: CanActivateFn = (_route, state): Observable<boolean | UrlTree> => {
  const router = inject(Router);
  const auth = inject(Auth);

  return authState(auth).pipe(
    take(1),
    switchMap(user => {
      if (!user) return of<null>(null);                 // ⬅️ sem `as const`
      if (user.emailVerified) return of(user);
      return from(user.reload()).pipe(map(() => auth.currentUser));
    }),
    map(user => {
      if (!user) {
        return router.createUrlTree(['/login'], { queryParams: { redirectTo: state.url } });
      }
      if (!user.emailVerified) {
        return router.createUrlTree(['/register/welcome'], { queryParams: { redirectTo: state.url } });
      }
      return true;                                       // ⬅️ simples
    })
  );
};
