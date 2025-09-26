// src/app/core/guards/auth.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { of, from } from 'rxjs';
import { take, switchMap, map, catchError } from 'rxjs/operators';

import { FirestoreUserQueryService } from '../services/data-handling/firestore-user-query.service';
import { Auth, user } from '@angular/fire/auth';
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

  return user(auth).pipe(
    take(1),
    switchMap((u) => {
      if (!u) return of<UrlTree | boolean>(toLogin());

      // força refresh para capturar disable/delete de Console/Admin
      return from(u.reload()).pipe(
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
