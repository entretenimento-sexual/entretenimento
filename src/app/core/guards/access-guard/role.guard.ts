//src\app\core\guards\access-guard\role.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { switchMap, take, map, of } from 'rxjs';

import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { buildRedirectTree, guardLog } from '../_shared-guard/guard-utils';

export const roleGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);
  const currentUserStore = inject(CurrentUserStoreService);
  const userQuery = inject(FirestoreUserQueryService);

  const allowed = (route.data?.['allowedRoles'] as string[] | undefined) ?? [];

  return currentUserStore.getLoggedUserUID$().pipe(
    take(1),
    switchMap((uid) => {
      if (!uid) return of(buildRedirectTree(router, '/login', state.url));

      return userQuery.getUserOnce$(uid).pipe(
        take(1),
        map((user) => {
          const role = (user?.role || '').toLowerCase();
          const ok = allowed.length ? allowed.map(x => x.toLowerCase()).includes(role) : true;

          guardLog('role', 'uid:', uid, 'role:', role, 'allowed:', allowed, 'ok:', ok);

          return ok ? true : buildRedirectTree(router, '/dashboard/principal', state.url, { reason: 'role_denied' });
        })
      );
    })
  );
};
