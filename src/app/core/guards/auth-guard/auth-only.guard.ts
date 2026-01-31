// ssrc\app\core\guards\auth-guard\auth-only.guard.ts
// Não esqueça os comentáros explicativos sobre o propósito desse guard.
// Garante que apenas usuários autenticados possam acessar determinadas rotas.
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { defer, from, map, of, catchError } from 'rxjs';

export const authOnlyGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  const auth = inject(Auth);

  const toLogin = () =>
    router.createUrlTree(['/login'], { queryParams: { redirectTo: state.url } });

  // ✅ espera a restauração e decide com base em currentUser (sem authState)
  return defer(() => from((auth as any).authStateReady?.() ?? Promise.resolve())).pipe(
    map(() => !!auth.currentUser ? true : toLogin()),
    catchError(() => of(toLogin()))
  );
};
