// src/app/core/guards/access-guard/admin.guard.ts
// Guard de acesso: permite rota apenas para usuários com claim de admin.
//
// PONTOS IMPORTANTES:
// 1) NÃO usar getIdTokenResult(true) aqui.
//    - "true" força refresh do token e pode gerar loop (securetoken + onIdTokenChanged).
// 2) take(1) garante que o guard conclui rapidamente (não fica "vivo").
// 3) Falha segura: se der erro, retorna false e redireciona.
import { inject } from '@angular/core';
import { CanActivateChildFn, CanMatchFn, Router } from '@angular/router';
import { Auth, user } from '@angular/fire/auth';
import { from, of } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';

// Type do Firebase SDK (tem .claims)
import type { IdTokenResult, User as FirebaseUser } from 'firebase/auth';

function isAdmin$() {
  const auth = inject(Auth);
  const geh = inject(GlobalErrorHandlerService);

  return user(auth).pipe(
    take(1), // ✅ o guard precisa ser "one-shot"
    switchMap((u: FirebaseUser | null) => {
      if (!u) return of<IdTokenResult | null>(null);

      // ✅ sem force refresh
      return from(u.getIdTokenResult()).pipe(
        catchError((e) => {
          try { geh.handleError(e); } catch { }
          return of<IdTokenResult | null>(null);
        })
      );
    }),
    map((res) => {
      const claims = (res?.claims ?? {}) as any;

      return !!claims.admin
        || claims.role === 'admin'
        || (Array.isArray(claims.roles) && claims.roles.includes('admin'));
    }),
    catchError((e) => {
      // Guard não deve quebrar a navegação; registra e falha seguro
      try { geh.handleError(e); } catch { }
      return of(false);
    })
  );
}

export const adminCanMatch: CanMatchFn = () =>
  isAdmin$().pipe(map((ok) => ok ? true : inject(Router).createUrlTree(['/dashboard'])));

export const adminCanActivateChild: CanActivateChildFn = () =>
  isAdmin$().pipe(map((ok) => ok ? true : inject(Router).createUrlTree(['/dashboard'])));
