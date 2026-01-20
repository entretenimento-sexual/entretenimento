// src/app/core/guards/auth-redirect.guard.ts
// Não esqueça os comentáros explicativos sobre o propósito desse guard.
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { defer, from, map, of, catchError } from 'rxjs';

export const authRedirectGuard: CanActivateFn = (_route, _state) => {
  const router = inject(Router);
  const auth = inject(Auth);

  return defer(() => from((auth as any).authStateReady?.() ?? Promise.resolve())).pipe(
    map(() => auth.currentUser ? router.createUrlTree(['/dashboard/principal']) : true),
    catchError(() => of(true))
  );
};
