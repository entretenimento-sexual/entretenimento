// src/app/core/guards/auth-only.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Observable, of, from } from 'rxjs';
import { map, take, switchMap, catchError } from 'rxjs/operators';

// ✅ AngularFire (zona-safe)
import { Auth, authState } from '@angular/fire/auth';

export const authOnlyGuard: CanActivateFn = (_route, state): Observable<boolean | UrlTree> => {
  const router = inject(Router);
  const auth = inject(Auth); // ⬅️ vem do provideAuth(...) no AppModule

  const toLogin = () => router.createUrlTree(['/login'], { queryParams: { redirectTo: state.url } });

  // Observa o estado de auth; se tiver user, faz um reload defensivo
  return authState(auth).pipe(
    take(1),
    switchMap(user => {
      if (!user) return of(toLogin());
      return from(user.reload()).pipe(
        catchError(() => of(void 0)),
        map(() => (auth.currentUser ? true : toLogin()))
      );
    })
  );
};
