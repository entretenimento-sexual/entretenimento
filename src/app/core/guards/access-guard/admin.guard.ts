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
import { Firestore } from '@angular/fire/firestore';
import { doc, getDocFromServer } from 'firebase/firestore';
import { from, of } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';

// Type do Firebase SDK (tem .claims)
import type { IdTokenResult, User as FirebaseUser } from 'firebase/auth';

function isAdmin$() {
  const auth = inject(Auth);
  const firestore = inject(Firestore);
  const geh = inject(GlobalErrorHandlerService);

  return user(auth).pipe(
    take(1), // ✅ o guard precisa ser "one-shot"
    switchMap((u: FirebaseUser | null) => {
      if (!u) return of<{ token: IdTokenResult | null; uid: string | null }>({ token: null, uid: null });

      // ✅ sem force refresh
      return from(u.getIdTokenResult()).pipe(
        map((token) => ({ token, uid: u.uid })),
        catchError((e) => {
          try { geh.handleError(e); } catch { }
          return of({ token: null, uid: null });
        })
      );
    }),
    switchMap(({ token, uid }) => {
      const claims = (token?.claims ?? {}) as Record<string, unknown>;
      const claimAllows = claims['admin'] === true
        || claims['role'] === 'admin'
        || (Array.isArray(claims['roles']) && claims['roles'].includes('admin'));
      if (!claimAllows || !uid) return of(false);

      // getDocFromServer impede conceder acesso com snapshot local obsoleto.
      // Rules permitem leitura do próprio users/{uid}, mas o backend continua
      // sendo a autoridade das operações administrativas.
      return from(getDocFromServer(doc(firestore, 'users', uid))).pipe(
        map((snapshot) => {
          if (!snapshot.exists()) return false;
          const account = snapshot.data();
          return account['accountStatus'] == null || account['accountStatus'] === 'active'
            ? account['suspended'] !== true
              && account['accountLocked'] !== true
              && account['interactionBlocked'] !== true
              && account['loginAllowed'] !== false
              && (
                account['role'] === 'admin'
                || account['admin'] === true
                || account['superadmin'] === true
              )
            : false;
        })
      );
    }),
    catchError((e) => {
      // Guard não deve quebrar a navegação; registra e falha seguro
      try { geh.handleError(e); } catch { }
      return of(false);
    })
  );
}

export const adminCanMatch: CanMatchFn = () => {
  const router = inject(Router);

  return isAdmin$().pipe(
    map((ok) =>
      ok ? true : router.createUrlTree(['/dashboard'])
    )
  );
};

export const adminCanActivateChild: CanActivateChildFn = () => {
  const router = inject(Router);

  return isAdmin$().pipe(
    map((ok) =>
      ok ? true : router.createUrlTree(['/dashboard'])
    )
  );
};
