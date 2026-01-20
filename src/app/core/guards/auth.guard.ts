// src/app/core/guards/auth.guard.ts
// Não esqueça os comentáros explicativos sobre o propósito desse guard.
import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { defer, from, map, of, switchMap, take, catchError } from 'rxjs';

import { FirestoreUserQueryService } from '../services/data-handling/firestore-user-query.service';
import { Auth } from '@angular/fire/auth';
import { environment } from 'src/environments/environment';

export const authGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  const auth = inject(Auth);
  const userQuery = inject(FirestoreUserQueryService);

  const toLogin = () =>
    router.createUrlTree(['/login'], { queryParams: { redirectTo: state.url } });

  const toWelcome = () =>
    router.createUrlTree(['/register/welcome'], {
      queryParams: { autocheck: '1', redirectTo: state.url },
    });

  const enforceVerified = !!environment?.features?.enforceEmailVerified;

  // ✅ Espera a restauração e decide com base em auth.currentUser
  return defer(() => from((auth as any).authStateReady?.() ?? Promise.resolve())).pipe(
    map(() => auth.currentUser),
    switchMap((u) => {
      if (!u) return of<UrlTree | boolean>(toLogin());

      // (opcional) reload defensivo, mas sem quebrar a decisão se falhar
      return defer(() => from(u.reload())).pipe(
        catchError(() => of(void 0)),
        map(() => auth.currentUser),
        switchMap((refreshed) => {
          if (!refreshed) return of<UrlTree | boolean>(toLogin());

          // consulta doc do Firestore para decidir destino
          return userQuery.getUser(refreshed.uid).pipe(
            take(1),
            map((userDoc) => {
              if (!userDoc) return toWelcome(); // sem doc ainda → welcome
              if (enforceVerified && !refreshed.emailVerified) return toWelcome();
              return true;
            }),
            // erro de rede/consulta → degrade para welcome (não /login)
            catchError(() => of<UrlTree | boolean>(toWelcome()))
          );
        })
      );
    })
  );
};
