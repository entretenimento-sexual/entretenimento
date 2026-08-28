// src/app/core/guards/compliance/adult-content-consent.guard.ts
// -----------------------------------------------------------------------------
// ADULT CONTENT CONSENT GUARD
// -----------------------------------------------------------------------------
// Protege conteúdo adulto e fluxos sociais dependentes dos documentos legais e
// do consentimento inicial.
//
// Ordem fail-closed:
// 1. exige Termos de Uso materiais vigentes quando a política do ambiente exige;
// 2. exige consentimento adulto quando aplicável;
// 3. libera o recurso protegido.
//
// Controles essenciais de conta e notificações permanecem acessíveis após
// autenticação para permitir ciência, contestação, privacidade, reativação ou
// cancelamento de exclusão.
// -----------------------------------------------------------------------------
import { inject } from '@angular/core';
import { CanActivateFn, Router, type GuardResult } from '@angular/router';
import { Observable, combineLatest, of } from 'rxjs';
import { catchError, filter, map, take } from 'rxjs/operators';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { AdultConsentService } from 'src/app/core/services/compliance/adult-consent.service';
import { isCurrentLegalAcceptanceSatisfied } from 'src/app/core/services/compliance/terms-acceptance.service';
import { buildRedirectTree, guardLog } from '../_shared-guard/guard-utils';

export const adultContentConsentGuard: CanActivateFn = (
  _route,
  state
): GuardResult | Observable<GuardResult> => {
  const router = inject(Router);
  const session = inject(AuthSessionService);
  const currentUser = inject(CurrentUserStoreService);
  const adultConsent = inject(AdultConsentService);

  const path = String(state.url ?? '').split(/[?#]/, 1)[0] || '/';
  const isEssentialAccountPath =
    path === '/conta' || path.startsWith('/conta/');

  if (isEssentialAccountPath) {
    guardLog('adult-consent', 'essential-account-path-bypass', {
      url: state.url,
    });
    return true;
  }

  const redirectToTerms = (): GuardResult => {
    guardLog('adult-consent', 'redirect-to-current-terms', {
      url: state.url,
    });

    return buildRedirectTree(
      router,
      '/register/aceitar-termos',
      state.url,
      { reason: 'material_terms_update_required' }
    );
  };

  const redirectToConsent = (): GuardResult => {
    guardLog('adult-consent', 'redirect-to-initial-consent', {
      url: state.url,
    });

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
      if (!authUser) return true;

      if (!isCurrentLegalAcceptanceSatisfied(appUser?.acceptedTerms)) {
        return redirectToTerms();
      }

      const initialConsentRequired =
        appUser?.initialAdultConsentRequired !== false;

      if (!initialConsentRequired) {
        guardLog('adult-consent', 'explicitly-not-required', {
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
    catchError(() => of(redirectToTerms()))
  );
};
