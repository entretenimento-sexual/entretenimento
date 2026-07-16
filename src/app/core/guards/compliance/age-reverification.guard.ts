import { inject } from '@angular/core';
import { CanActivateFn, Router, type GuardResult } from '@angular/router';
import { Observable, combineLatest, of } from 'rxjs';
import { catchError, filter, map, take } from 'rxjs/operators';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { buildRedirectTree, guardLog } from '../_shared-guard/guard-utils';
import { isAgeReverificationAccessRestricted } from './age-reverification-status.util';

export const ageReverificationGuard: CanActivateFn = (
  _route,
  state
): GuardResult | Observable<GuardResult> => {
  const router = inject(Router);
  const session = inject(AuthSessionService);
  const currentUser = inject(CurrentUserStoreService);

  const redirectToReverification = (): GuardResult => {
    guardLog('age-reverification', 'redirect-to-reverification', {
      url: state.url,
    });

    return buildRedirectTree(router, '/adulto/revalidar', state.url, {
      reason: 'profile_minor_safety_reverification_required',
    });
  };

  return combineLatest([
    session.ready$,
    session.authUser$,
    currentUser.user$,
  ]).pipe(
    filter(([ready, authUser, appUser]) => {
      if (!ready) return false;
      if (!authUser) return true;
      return appUser !== undefined;
    }),
    take(1),
    map(([_, authUser, appUser]): GuardResult => {
      if (!authUser) {
        return true;
      }

      if (isAgeReverificationAccessRestricted(appUser?.ageReverification)) {
        return redirectToReverification();
      }

      guardLog('age-reverification', 'access-allowed', { url: state.url });
      return true;
    }),
    catchError(() => of(redirectToReverification()))
  );
};
