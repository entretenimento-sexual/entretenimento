// src/app/core/guards/access-guard/role.guard.ts
// Guard genérico de acesso por role.
//
// Fronteira canônica:
// - sessão/UID: CurrentUserStoreService/AuthSessionService;
// - hidratação do perfil: CurrentUserStoreService;
// - free/basic/premium/vip: AccessControlService, que deriva a capacidade da
//   projeção canônica de assinatura;
// - admin: preservado pelo próprio AccessControlService.
//
// Este guard não lê role diretamente do documento do usuário e não consulta
// Firestore como autoridade alternativa de assinatura.
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { combineLatest, of } from 'rxjs';
import {
  catchError,
  filter,
  map,
  switchMap,
  take,
} from 'rxjs/operators';

import {
  AccessControlService,
  type UserRole,
} from 'src/app/core/services/autentication/auth/access-control.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { buildRedirectTree, guardLog } from '../_shared-guard/guard-utils';

const VALID_ROLES = new Set<UserRole>([
  'visitante',
  'free',
  'basic',
  'premium',
  'vip',
  'admin',
]);

function normalizeAllowedRoles(value: unknown): UserRole[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map((item) => String(item ?? '').trim().toLowerCase())
        .filter((item): item is UserRole =>
          VALID_ROLES.has(item as UserRole)
        )
    )
  );
}

export const roleGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);
  const currentUserStore = inject(CurrentUserStoreService);
  const access = inject(AccessControlService);
  const applicationError = inject(ApplicationErrorService);

  const allowed = normalizeAllowedRoles(route.data?.['allowedRoles']);

  const uid$ = currentUserStore.getLoggedUserUID$().pipe(take(1));
  const storeUser$ = currentUserStore.user$.pipe(
    filter((user) => user !== undefined),
    take(1)
  );

  return combineLatest([uid$, storeUser$]).pipe(
    switchMap(([uid, storeUser]) => {
      if (!uid) {
        return of(buildRedirectTree(router, '/login', state.url));
      }

      if (!storeUser) {
        return of(
          buildRedirectTree(
            router,
            '/dashboard/principal',
            state.url,
            { reason: 'role_profile_unavailable' }
          )
        );
      }

      if (allowed.length === 0) {
        return of(true);
      }

      return access.hasAny$(allowed).pipe(
        take(1),
        map((ok) => {
          guardLog(
            'role',
            'uid:',
            uid,
            'source:',
            'AccessControlService',
            'allowed:',
            allowed,
            'ok:',
            ok
          );

          return ok
            ? true
            : buildRedirectTree(
                router,
                '/dashboard/principal',
                state.url,
                { reason: 'role_denied' }
              );
        })
      );
    }),
    catchError((error: unknown) => {
      try {
        applicationError.report(error, {
          feature: 'access-guard',
          operation: 'roleGuard',
          fallbackMessage: 'Não foi possível validar seu acesso agora.',
          presentation: { surface: 'none', severity: 'error' },
          metadata: {
            scope: 'roleGuard',
            allowedRoles: allowed,
          },
        });
      } catch {
        // O guard permanece fail-closed mesmo se o diagnóstico falhar.
      }

      return of(
        buildRedirectTree(
          router,
          '/dashboard/principal',
          state.url,
          { reason: 'role_guard_error' }
        )
      );
    })
  );
};
