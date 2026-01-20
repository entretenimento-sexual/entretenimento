// src/app/core/guards/guest-only.guard.ts
// Não esqueça os comentáros explicativos sobre o propósito desse guard.
// Guard "guest-only": impede /login e /register para usuário já autenticado.
//
// Diferença do "authGuard":
// - authGuard protege rotas privadas (precisa estar logado).
// - guestOnlyGuard protege rotas públicas (precisa estar deslogado).
// - Se NÃO estiver autenticado: permite.
// - Se estiver autenticado e emailVerified=false: permite /register (fluxo de verificação),
//   mas evita /login (redireciona para /register/welcome).
// - Se estiver autenticado e emailVerified=true: redireciona para o app (dashboard/última rota útil).

import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { defer, from, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { GlobalErrorHandlerService } from '../services/error-handler/global-error-handler.service';
import { environment } from 'src/environments/environment';

/**
 * Verifica se a rota atual OU ALGUM FILHO dela permite navegação mesmo com usuário autenticado.
 *
 * Por que olhar filhos?
 * - Quando você aplica o guard no path "register" do AppRouting,
 *   ele também cobre "/register/welcome" etc.
 * - Então você marca os filhos permitidos com: data: { allowAuthenticated: true }
 *   e o guard libera apenas esses filhos.
 */
function routeOrChildrenAllowAuthenticated(route: ActivatedRouteSnapshot): boolean {
  if (route.data?.['allowAuthenticated'] === true) return true;

  for (const child of route.children ?? []) {
    if (routeOrChildrenAllowAuthenticated(child)) return true;
  }

  return false;
}

export const guestOnlyGuard: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  _state: RouterStateSnapshot
) => {
  const router = inject(Router);
  const auth = inject(Auth);
  const globalErrorHandler = inject(GlobalErrorHandlerService);

  // Para onde mandar um usuário autenticado "normal"
  const toDashboard = () => router.createUrlTree(['/dashboard/principal']);

  // Para onde mandar um usuário autenticado, mas ainda sem e-mail verificado (se você exigir isso)
  const toWelcome = () =>
    router.createUrlTree(['/register/welcome'], {
      queryParams: { autocheck: '1', redirectTo: '/dashboard/principal' },
    });

  const enforceVerified = !!environment?.features?.enforceEmailVerified;

  // ✅ Regra: se algum filho da rota atual permitir autenticado, a gente libera.
  const allowAuthenticatedHere = routeOrChildrenAllowAuthenticated(route);

  /**
   * Fonte de verdade:
   * - Espera o Firebase restaurar a sessão (evita "flash" de currentUser null no boot)
   * - Decide por auth.currentUser (que é o estado real da sessão)
   */
  return defer(() => from((auth as any).authStateReady?.() ?? Promise.resolve())).pipe(
    map(() => auth.currentUser ?? null),

    switchMap((user) => {
      // ✅ Visitante (sem sessão): pode entrar em /login e /register
      if (!user) return of<UrlTree | boolean>(true);

      // ✅ Se você explicitamente permitiu autenticado nessa rota/filho (ex.: /register/welcome), libera
      if (allowAuthenticatedHere) return of<UrlTree | boolean>(true);

      // Redundância útil: atualiza metadados (ex.: emailVerified) sem depender de estado stale
      return defer(() => from(user.reload())).pipe(
        catchError(() => of(void 0)), // não trava guard se o reload falhar
        map(() => auth.currentUser ?? user),
        map((refreshed) => {
          // Se você exige email verificado e ainda não está, manda pro fluxo de verificação/onboarding
          if (enforceVerified && !refreshed.emailVerified) return toWelcome();

          // Caso contrário: não deixa abrir /login ou /register -> manda pra home autenticada
          return toDashboard();
        })
      );
    }),

    /**
     * Importante: guard nunca deve "quebrar" o app.
     * Se algo estranho acontecer, a escolha mais segura é liberar acesso ao login/register.
     * (Bloquear em erro pode deixar o usuário preso sem conseguir entrar/sair.)
     */
    catchError((err) => {
      globalErrorHandler.handleError(err);
      return of<UrlTree | boolean>(true);
    })
  );
};
