// src/app/core/guards/auth.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Observable, of, from } from 'rxjs';
import { take, switchMap, map, catchError } from 'rxjs/operators';
import { FirestoreUserQueryService } from '../services/data-handling/firestore-user-query.service';
import { FIREBASE_AUTH } from '../firebase/firebase.tokens';
import { onAuthStateChanged, type Auth, type User } from 'firebase/auth';
import { environment } from 'src/environments/environment';

export const authGuard: CanActivateFn = (_route, state): Observable<boolean | UrlTree> => {
  const router = inject(Router);
  const auth = inject(FIREBASE_AUTH) as Auth;
  const userQuery = inject(FirestoreUserQueryService);

  const toLogin = () => router.createUrlTree(['/login'], { queryParams: { redirectTo: state.url } });
  const toWelcome = () => router.createUrlTree(
    ['/register/welcome'],
    { queryParams: { autocheck: '1', redirectTo: state.url } }
  );

  const enforceVerified = !!environment?.features?.enforceEmailVerified;

  const auth$ = new Observable<User | null>((obs) => {
    const unsub = onAuthStateChanged(
      auth,
      (u) => { obs.next(u); obs.complete(); },
      () => { obs.next(null); obs.complete(); }
    );
    return () => unsub();
  });

  return auth$.pipe(
    take(1),
    switchMap((user) => {
      if (!user) return of<UrlTree | boolean>(toLogin());

      // Força refresh para detectar usuário desabilitado/excluído
      return from(user.reload()).pipe(
        catchError(() => of(void 0)),
        map(() => auth.currentUser),
        switchMap((refreshed) => {
          if (!refreshed) return of<UrlTree | boolean>(toLogin());

          // Checa doc do Firestore (pode não existir logo após o login/registro)
          return userQuery.getUser(refreshed.uid).pipe(
            take(1),
            map(userDoc => {
              if (!userDoc) {
                // ✅ Sem doc ainda? Leve para o welcome, não para /login
                return toWelcome();
              }
              // ✅ Exigir e-mail verificado apenas quando a flag estiver ativa
              if (enforceVerified && !refreshed.emailVerified) {
                return toWelcome();
              }
              return true;
            }),
            // Em erro de rede/consulta, degrade para welcome (não /login)
            catchError(() => of<UrlTree | boolean>(toWelcome()))
          );
        })
      );
    })
  );
};
