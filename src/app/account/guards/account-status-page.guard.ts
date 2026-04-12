//src\app\account\guards\account-status-page.guard.ts
import { inject } from '@angular/core';
import { Router, type UrlTree, type CanActivateFn } from '@angular/router';
import { combineLatest, type Observable } from 'rxjs';
import { filter, map, take } from 'rxjs/operators';

import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';

type LifecycleAccountStatus =
  | 'active'
  | 'self_suspended'
  | 'moderation_suspended'
  | 'pending_deletion'
  | 'deleted';

function normalizeAccountStatus(user: any): LifecycleAccountStatus | 'unresolved' {
  if (user === undefined) return 'unresolved';

  const raw = String(user?.accountStatus ?? '')
    .trim()
    .toLowerCase();

  if (raw === 'active') return 'active';
  if (raw === 'self_suspended') return 'self_suspended';
  if (raw === 'moderation_suspended') return 'moderation_suspended';
  if (raw === 'pending_deletion') return 'pending_deletion';
  if (raw === 'deleted') return 'deleted';

  if (user?.suspended === true) {
    return user?.suspensionSource === 'self'
      ? 'self_suspended'
      : 'moderation_suspended';
  }

  return 'active';
}

/**
 * Guard da rota /conta/status
 *
 * Regras:
 * - se conta ainda está bloqueada => permite
 * - se conta está ativa => manda para /conta
 * - se não há sessão, o auth guard já redireciona para login
 */
export const accountStatusPageGuard: CanActivateFn = (): Observable<boolean | UrlTree> => {
  const router = inject(Router);
  const authSession = inject(AuthSessionService);
  const currentUserStore = inject(CurrentUserStoreService);

  return combineLatest([
    authSession.ready$,
    authSession.authUser$,
    currentUserStore.user$,
  ]).pipe(
    filter(([ready, authUser, appUser]) => {
      if (!ready) return false;
      if (!authUser) return true;
      return appUser !== undefined;
    }),
    take(1),
    map(([_, authUser, appUser]) => {
      if (!authUser) return true;

      const status = normalizeAccountStatus(appUser);

      if (
        status === 'self_suspended' ||
        status === 'moderation_suspended' ||
        status === 'pending_deletion' ||
        status === 'deleted'
      ) {
        return true;
      }

      return router.createUrlTree(['/conta']);
    })
  );
};