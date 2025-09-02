// src/app/core/guards/auth-only.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { map, take } from 'rxjs/operators';

export const authOnlyGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  const afAuth = inject(AngularFireAuth);

  return afAuth.authState.pipe(
    take(1),
    map(user => user ? true : router.createUrlTree(['/login'], { queryParams: { redirectTo: state.url } }))
  );
};
