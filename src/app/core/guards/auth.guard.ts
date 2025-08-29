// src/app/core/guards/auth.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { Observable, of } from 'rxjs';
import { take, switchMap } from 'rxjs/operators';

export const authGuard: CanActivateFn = (): Observable<boolean | UrlTree> => {
  const router = inject(Router);
  const auth = getAuth();

  return new Observable<User | null>((subscriber) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      subscriber.next(user);
      subscriber.complete();
      unsubscribe();
    });
  }).pipe(
    take(1),
    switchMap((user) => {
      if (!user) {
        console.log('🚫 [authGuard] Não autenticado. Redirecionando para login.');
        return of(router.createUrlTree(['/login']));
      }

      if (!user.emailVerified) {
        console.log('⚠️ [authGuard] E-mail não verificado. Redirecionando para register/welcome.');
        return of(router.createUrlTree(['/register/welcome']));
      }

      console.log('✅ [authGuard] Acesso permitido.');
      return of(true);
    })
  );
};
