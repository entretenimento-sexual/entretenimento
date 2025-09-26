// src/app/core/guards/auth-redirect.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { of, Observable } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';

import { FirestoreUserQueryService } from '../services/data-handling/firestore-user-query.service';

// ✅ use o Auth do AngularFire e o stream pronto
import { Auth, user } from '@angular/fire/auth';
import type { User } from 'firebase/auth';

/**
 * Guard para rotas "públicas" (login/registro) com exceção controlada:
 * - Se a rota tiver data: { allowUnverified: true }, usuários logados mas
 *   NÃO verificados e/ou com perfil incompleto podem entrar (ex.: welcome).
 * - Caso contrário, usuários logados serão redirecionados:
 *     - perfil incompleto ou não verificado → /register/welcome?autocheck=1
 *     - completo e verificado → /dashboard/principal
 */
export const authRedirectGuard: CanActivateFn = (route, state): Observable<boolean | UrlTree> => {
  const router = inject(Router);
  const users = inject(FirestoreUserQueryService);
  const auth = inject(Auth); // ✅ mesma instância criada por provideAuth no app.module

  const allowUnverified = route.data?.['allowUnverified'] === true;

  // ✅ observable zone-safe do AngularFire, sem criar Observable manual
  return user(auth).pipe(
    take(1),
    switchMap((fbUser: User | null) => {
      if (!fbUser) {
        console.log('👤 Nenhum usuário autenticado. Acesso permitido à rota atual.');
        return of(true);
      }

      return users.getUser(fbUser.uid).pipe(
        take(1),
        map((uDoc) => {
          const profileCompleted = uDoc?.profileCompleted === true;
          const emailVerifiedDoc = uDoc?.emailVerified === true;
          const isFullyReady = profileCompleted && emailVerifiedDoc;

          if (allowUnverified) {
            if (!isFullyReady) {
              console.log('⚠️ Logado, mas pendente → allowUnverified liberada.');
              return true;
            }
            console.log('✅ Completo/verificado em allowUnverified → dashboard.');
            return router.createUrlTree(['/dashboard/principal']);
          }

          if (!isFullyReady) {
            console.log('ℹ️ Logado mas pendente → /register/welcome');
            const qp: Record<string, string> = { autocheck: '1' };
            if (state?.url && state.url !== '/login') qp['redirectTo'] = state.url;
            return router.createUrlTree(['/register/welcome'], { queryParams: qp });
          }

          console.log('👤 Autenticado e pronto → dashboard.');
          return router.createUrlTree(['/dashboard/principal']);
        }),
        catchError((err) => {
          console.log('❌ Erro Firestore (guard):', err);
          if (allowUnverified) return of(true);
          const qp: Record<string, string> = { autocheck: '1' };
          if (state?.url && state.url !== '/login') qp['redirectTo'] = state.url;
          return of(router.createUrlTree(['/register/welcome'], { queryParams: qp }) as UrlTree);
        })
      );
    }),
    catchError((err) => {
      console.log('❌ Erro no estado de auth (guard):', err);
      return of(true);
    })
  );
};
