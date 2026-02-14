// src/app/core/guards/access-guard/role.guard.ts
// Guard de acesso: permite rota apenas para usuários com roles específicas.
//
// Boas práticas adotadas:
// - Fluxo one-shot (take(1)) → guard não fica "vivo" nem cria listeners.
// - Fail-safe: qualquer erro resulta em redirect controlado (não quebra navegação).
// - Preferência por dados locais (CurrentUserStore) quando disponíveis, com fallback
//   para Firestore only-once (evita leitura desnecessária em cada navegação).

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { combineLatest, of } from 'rxjs';
import { catchError, map, switchMap, take, filter } from 'rxjs/operators';

import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { buildRedirectTree, guardLog } from '../_shared-guard/guard-utils';

export const roleGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);
  const currentUserStore = inject(CurrentUserStoreService);
  const userQuery = inject(FirestoreUserQueryService);
  const geh = inject(GlobalErrorHandlerService);

  const allowed = (route.data?.['allowedRoles'] as string[] | undefined) ?? [];
  const allowedNormalized = allowed.map((x) => (x ?? '').toLowerCase());

  // 1) UID (fonte de sessão)
  const uid$ = currentUserStore.getLoggedUserUID$().pipe(take(1));

  // 2) Snapshot de user do store (pode ser null; ignorar undefined inicial)
  const storeUser$ = currentUserStore.user$.pipe(
    filter((u) => u !== undefined),
    take(1)
  );

  return combineLatest([uid$, storeUser$]).pipe(
    switchMap(([uid, storeUser]) => {
      if (!uid) return of(buildRedirectTree(router, '/login', state.url));

      // Preferência: role já resolvida no store (evita Firestore)
      const roleFromStore = (storeUser as any)?.role ? String((storeUser as any).role).toLowerCase() : '';

      if (roleFromStore) {
        const ok = allowedNormalized.length ? allowedNormalized.includes(roleFromStore) : true;

        guardLog('role', 'uid:', uid, 'role(store):', roleFromStore, 'allowed:', allowed, 'ok:', ok);

        return of(
          ok ? true : buildRedirectTree(router, '/dashboard/principal', state.url, { reason: 'role_denied' })
        );
      }

      // Fallback: busca one-shot no Firestore
      return userQuery.getUserOnce$(uid).pipe(
        take(1),
        map((user) => {
          const role = (user?.role || '').toLowerCase();
          const ok = allowedNormalized.length ? allowedNormalized.includes(role) : true;

          guardLog('role', 'uid:', uid, 'role(fs):', role, 'allowed:', allowed, 'ok:', ok);

          return ok ? true : buildRedirectTree(router, '/dashboard/principal', state.url, { reason: 'role_denied' });
        })
      );
    }),
    catchError((err) => {
      // Fail-safe: log central e redirect seguro (não derruba navegação)
      try { geh.handleError(err); } catch { }
      return of(buildRedirectTree(router, '/dashboard/principal', state.url, { reason: 'role_guard_error' }));
    })
  );
};
