// src/app/core/guards/admin.guard.ts
import { inject } from '@angular/core';
import { CanMatchFn, CanActivateChildFn, Router, UrlTree } from '@angular/router';
import { Auth, user } from '@angular/fire/auth';
import { from, map, catchError, of, switchMap } from 'rxjs';

function isAdmin$() {
  const auth = inject(Auth);
  const router = inject(Router);

  // Observa usuário logado; força refresh do token para pegar claims atualizadas
  return user(auth).pipe(
    switchMap(u => u ? from(u.getIdTokenResult(true)) : of(null)),
    map(res => {
      const claims: any = res?.claims || {};
      const ok = !!claims.admin
        || claims.role === 'admin'
        || (Array.isArray(claims.roles) && claims.roles.includes('admin'));
      return ok;
    }),
    catchError(() => of(false))
  );
}

export const adminCanMatch: CanMatchFn = () =>
  isAdmin$().pipe(map(ok => ok ? true : inject(Router).createUrlTree(['/dashboard'])));

export const adminCanActivateChild: CanActivateChildFn = () =>
  isAdmin$().pipe(map(ok => ok ? true : inject(Router).createUrlTree(['/dashboard'])));
