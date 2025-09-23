// src/app/core/guards/auth-only.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Observable, of, from } from 'rxjs';
import { map, take, switchMap, catchError } from 'rxjs/operators';
import { FIREBASE_AUTH } from '../firebase/firebase.tokens';
import { onAuthStateChanged, type Auth, type User } from 'firebase/auth';

export const authOnlyGuard: CanActivateFn = (_route, state): Observable<boolean | UrlTree> => {
  const router = inject(Router);
  const auth = inject(FIREBASE_AUTH) as Auth;

  const toLogin = () => router.createUrlTree(['/login'], { queryParams: { redirectTo: state.url } });

  // Se já há currentUser, faz um reload rápido para pegar conta desabilitada/excluída
  const current = auth.currentUser;
  if (current) {
    return from(current.reload()).pipe(
      catchError(() => of(void 0)),
      map(() => auth.currentUser ? true : toLogin())
    );
  }

  // Fallback: espera a 1ª emissão do estado de auth
  return new Observable<User | null>((obs) => {
    const unsub = onAuthStateChanged(
      auth,
      (u) => { obs.next(u); obs.complete(); },
      () => { obs.next(null); obs.complete(); }
    );
    return () => unsub();
  }).pipe(
    take(1),
    map(u => u ? true : toLogin())
  );
};
