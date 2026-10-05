import { inject } from '@angular/core';
import { CanActivateFn, Router, type GuardResult } from '@angular/router';
import { Observable, combineLatest, of } from 'rxjs';
import {
  catchError,
  filter,
  map,
  switchMap,
  take,
} from 'rxjs/operators';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { normalizeUserAccountLifecycleStatus } from 'src/app/core/services/autentication/auth/account-lifecycle.policy';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { AdultConsentService } from 'src/app/core/services/compliance/adult-consent.service';
import { AgeEligibilityService } from 'src/app/core/services/compliance/age-eligibility.service';
import {
  isCurrentTrustedAdultAgeProjection,
} from 'src/app/core/services/compliance/trusted-adult-age-assurance.policy';
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
  const ageEligibility = inject(AgeEligibilityService);

  const path = String(state.url ?? '').split(/[?#]/, 1)[0] || '/';
  const isEssentialAccountPath =
    path === '/conta' || path.startsWith('/conta/');

  if (isEssentialAccountPath) {
    guardLog('adult-access', 'essential-account-path-bypass', {
      url: state.url,
    });
    return true;
  }

  const redirectToTerms = (): GuardResult =>
    buildRedirectTree(
      router,
      '/register/aceitar-termos',
      state.url,
      { reason: 'material_terms_update_required' }
    );

  const redirectToAgeVerification = (): GuardResult =>
    buildRedirectTree(
      router,
      '/adulto/verificar-idade',
      state.url,
      { reason: 'trusted_age_verification_required' }
    );

  const redirectToConsent = (): GuardResult =>
    buildRedirectTree(
      router,
      '/adulto/confirmar',
      state.url,
      { reason: 'initial_adult_consent_required' }
    );

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
    switchMap(([_, authUser, appUser, accepted]) => {
      if (!authUser) {
        return of(true as GuardResult);
      }

      if (!isCurrentLegalAcceptanceSatisfied(appUser?.acceptedTerms)) {
        return of(redirectToTerms());
      }

      const admittedAccount =
        appUser?.profileCompleted === true &&
        normalizeUserAccountLifecycleStatus(appUser) === 'active';

      if (admittedAccount) {
        const initialConsentRequired =
          appUser?.initialAdultConsentRequired !== false;

        return of(
          !initialConsentRequired || accepted
            ? true as GuardResult
            : redirectToConsent()
        );
      }

      return ageEligibility.reconcileTrustedStateOncePerSession$().pipe(
        map((ageState): GuardResult => {
          if (!isCurrentTrustedAdultAgeProjection(ageState)) {
            return redirectToAgeVerification();
          }

          const initialConsentRequired =
            appUser?.initialAdultConsentRequired !== false;

          if (!initialConsentRequired || accepted) {
            return true;
          }

          return redirectToConsent();
        }),
        catchError(() => {
          const persistedAgeState = appUser?.ageEligibility;

          if (isCurrentTrustedAdultAgeProjection(persistedAgeState)) {
            const initialConsentRequired =
              appUser?.initialAdultConsentRequired !== false;

            return of(
              !initialConsentRequired || accepted
                ? true as GuardResult
                : redirectToConsent()
            );
          }

          return of(redirectToAgeVerification());
        })
      );
    }),
    catchError(() => of(redirectToTerms()))
  );
};
