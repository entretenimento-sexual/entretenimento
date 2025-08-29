//src\app\core\guards\auth-only.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { Observable, of } from 'rxjs';
import { take, switchMap } from 'rxjs/operators';

export const authOnlyGuard: CanActivateFn = (_route, state): Observable<boolean | UrlTree> => {
  const router = inject(Router);
  const auth = getAuth();

  return new Observable<User | null>((subscriber) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      subscriber.next(user);
      subscriber.complete();
      unsub();
    });
  }).pipe(
    take(1),
    switchMap((user) => {
      if (!user) {
        // não logado → manda pro login com redirect de volta
        return of(router.createUrlTree(['/login'], { queryParams: { redirectTo: state.url } }));
      }
      // logado (verificado ou não) → permite
      return of(true);
    })
  );
};
