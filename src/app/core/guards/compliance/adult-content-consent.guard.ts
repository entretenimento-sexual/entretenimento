// src/app/core/guards/compliance/adult-content-consent.guard.ts
// -----------------------------------------------------------------------------
// AdultContentConsentGuard
// -----------------------------------------------------------------------------
// Rede de segurança exclusiva do cadastro inicial.
//
// Regras:
// - somente contas novas marcadas com initialAdultConsentRequired=true precisam
//   passar por /adulto/confirmar;
// - contas legadas sem o marcador não recebem uma obrigação retroativa;
// - revalidação após denúncia usa guard e estado próprios;
// - o aceite canônico continua vindo de users/{uid}.adultConsent.
// -----------------------------------------------------------------------------

import { inject } from '@angular/core';
import { CanActivateFn, Router, type GuardResult } from '@angular/router';
import { Observable, combineLatest, of } from 'rxjs';
import { catchError, filter, map, take } from 'rxjs/operators';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { AdultConsentService } from 'src/app/core/services/compliance/adult-consent.service';
import { buildRedirectTree, guardLog } from '../_shared-guard/guard-utils';

export const adultContentConsentGuard: CanActivateFn = (
  _route,
  state
): GuardResult | Observable<GuardResult> => {
  const router = inject(Router);
  const session = inject(AuthSessionService);
  const currentUser = inject(CurrentUserStoreService);
  const adultConsent = inject(AdultConsentService);

  const redirectToConsent = (): GuardResult => {
    guardLog('adult-consent', 'redirect-to-initial-consent', { url: state.url });

    return buildRedirectTree(router, '/adulto/confirmar', state.url, {
      reason: 'initial_adult_consent_required',
    });
  };

  return combineLatest([
    session.ready$,
    session.authUser$,
    currentUser.user$,
    adultConsent.currentConsentAccepted$,
  ]).pipe(
    filter(([ready, authUser, appUser]) => {
      if (!ready) return false;
      if (!authUser) return true;
      return appUser !== undefined;
    }),
    take(1),
    map(([_, authUser, appUser, accepted]): GuardResult => {
      if (!authUser) {
        return true;
      }

      const initialConsentRequired =
        appUser?.initialAdultConsentRequired === true;

      if (!initialConsentRequired) {
        guardLog('adult-consent', 'not-required-after-registration', {
          url: state.url,
        });
        return true;
      }

      if (accepted) {
        guardLog('adult-consent', 'initial-consent-accepted', {
          url: state.url,
        });
        return true;
      }

      return redirectToConsent();
    }),
    catchError(() => of(redirectToConsent()))
  );
};
