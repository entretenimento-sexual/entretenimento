//src\app\core\guards\email-verified.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { Observable, of } from 'rxjs';
import { take, switchMap } from 'rxjs/operators';

export const emailVerifiedGuard: CanActivateFn = (_route, state): Observable<boolean | UrlTree> => {
  const router = inject(Router);
  const auth = getAuth();

  return new Observable<User | null>((sub) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      sub.next(user);
      sub.complete();
      unsub();
    });
  }).pipe(
    take(1),
    switchMap((user) => {
      if (!user) {
        return of(router.createUrlTree(['/login'], { queryParams: { redirectTo: state.url } }));
      }
      if (user.emailVerified) return of(true);

      // permite circular nas telas do fluxo de verificação
      const allowed = ['/register/welcome', '/post-verification/action', '/__/auth/action'];
      if (allowed.some(prefix => state.url.startsWith(prefix))) return of(true);

      return of(router.createUrlTree(['/register/welcome'], { queryParams: { redirectTo: state.url } }));
    })
  );
};
