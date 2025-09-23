// src/app/core/guards/auth-redirect.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { of, Observable } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';

import { FirestoreUserQueryService } from '../services/data-handling/firestore-user-query.service';
import { FIREBASE_AUTH } from '../firebase/firebase.tokens';
import { onAuthStateChanged, type Auth, type User } from 'firebase/auth';

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
  const auth = inject(FIREBASE_AUTH) as Auth;

  const allowUnverified = route.data?.['allowUnverified'] === true;

  // Observable do estado de auth (modular)
  const authState$ = new Observable<User | null>((observer) => {
    const unsub = onAuthStateChanged(
      auth,
      (u) => {
        observer.next(u);
        observer.complete();
      },
      (err) => observer.error?.(err)
    );
    return () => unsub();
  });

  return authState$.pipe(
    take(1),
    switchMap((user) => {
      // Não logado → sempre permite (login/registro/etc.)
      if (!user) {
        console.log('👤 Nenhum usuário autenticado. Acesso permitido à rota atual.');
        return of(true);
      }

      // Logado → busca doc no Firestore para decidir (perfil/emailVerified podem atrasar no Auth)
      return users.getUser(user.uid).pipe(
        take(1),
        map((uDoc) => {
          const profileCompleted = uDoc?.profileCompleted === true;
          const emailVerifiedDoc = uDoc?.emailVerified === true;
          const isFullyReady = profileCompleted && emailVerifiedDoc;

          // Rotas que ACEITAM não verificado/incompleto (ex.: /register/welcome)
          if (allowUnverified) {
            if (!isFullyReady) {
              console.log('⚠️ Usuario logado, mas não verificado e/ou perfil incompleto → rota allowUnverified liberada.');
              return true; // deixa entrar para finalizar/checkar
            }
            console.log('✅ Perfil completo e e-mail verificado em rota allowUnverified → redirecionando para dashboard.');
            return router.createUrlTree(['/dashboard/principal']);
          }

          // Rotas públicas normais (login/registro "raiz"): se já está logado,
          // decide melhor destino.
          if (!isFullyReady) {
            console.log('ℹ️ Usuario logado mas pendente → mandando para /register/welcome');
            const qp: Record<string, string> = { autocheck: '1' };
            // opcional: manter intenção original
            if (state?.url && state.url !== '/login') qp['redirectTo'] = state.url;
            return router.createUrlTree(['/register/welcome'], { queryParams: qp });
          }

          console.log('👤 Autenticado e pronto → redirecionando para dashboard.');
          return router.createUrlTree(['/dashboard/principal']);
        }),
        catchError((err) => {
          console.log('❌ Erro ao consultar dados do usuário no Firestore (guard):', err);

          // Fallback: se a rota aceita não verificado, libera; senão manda pro welcome
          if (allowUnverified) return of(true);

          const qp: Record<string, string> = { autocheck: '1' };
          if (state?.url && state.url !== '/login') qp['redirectTo'] = state.url;
          return of(router.createUrlTree(['/register/welcome'], { queryParams: qp }) as UrlTree);
        })
      );
    }),
    catchError((err) => {
      console.log('❌ Erro ao ler estado de autenticação (guard):', err);
      // Em caso de erro inesperado no próprio estado de auth, não bloqueie a navegação
      return of(true);
    })
  );
};
