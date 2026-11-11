import { inject } from '@angular/core';
import { CanActivateFn, Router, type GuardResult } from '@angular/router';
import { Observable, combineLatest, of } from 'rxjs';
import { catchError, filter, map, switchMap, take } from 'rxjs/operators';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { normalizeUserAccountLifecycleStatus } from 'src/app/core/services/autentication/auth/account-lifecycle.policy';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { AgeEligibilityService } from 'src/app/core/services/compliance/age-eligibility.service';
import { isCurrentAdultAccountAdmissionProjection } from 'src/app/core/services/compliance/trusted-adult-age-assurance.policy';
import { isCurrentLegalAcceptanceSatisfied } from 'src/app/core/services/compliance/terms-acceptance.service';
import { buildRedirectTree, guardLog } from '../_shared-guard/guard-utils';

/**
 * Nome histórico preservado para todas as rotas existentes.
 * Política nova: Termos vigentes + admissão etária canônica inicial;
 * contas completas usam Account Lifecycle, sem novo assurance por interação.
 * NÃO reintroduzir AdultConsent v1 como requisito de acesso.
 * A autorização real dos dados permanece nas Rules e nas Cloud Functions.
 */
export const adultContentConsentGuard: CanActivateFn = (_route, state): GuardResult | Observable<GuardResult> => {
  const router = inject(Router);
  const session = inject(AuthSessionService);
  const currentUser = inject(CurrentUserStoreService);
  const ageEligibility = inject(AgeEligibilityService);

  const path = String(state.url ?? '').split(/[?#]/, 1)[0] || '/';
  const essentialAccountPath = path === '/conta' || path.startsWith('/conta/');
  if (essentialAccountPath) {
    guardLog('adult-access', 'essential-account-path-bypass', {url: state.url});
    return true;
  }

  const terms = (): GuardResult => buildRedirectTree(router,
    '/register/aceitar-termos', state.url,
    { reason: 'material_terms_update_required' });
  const age = (): GuardResult => buildRedirectTree(router,
    '/adulto/verificar-idade', state.url,
    { reason: 'adult_account_admission_required' });

  return combineLatest([session.ready$, session.authUser$, currentUser.user$]).pipe(
    filter(([ready, authUser, appUser]) => {
      if (!ready) return false;
      if (!authUser) return true;
      return appUser !== undefined;
    }),
    take(1),
    switchMap(([_, authUser, appUser]): Observable<GuardResult> => {
      if (!authUser) return of(true);
      if (!isCurrentLegalAcceptanceSatisfied(appUser?.acceptedTerms)) return of(terms());

      const admittedAccount = appUser?.profileCompleted === true &&
        normalizeUserAccountLifecycleStatus(appUser) === 'active';
      if (admittedAccount) return of(true);

      // Onboarding pré-admissão pode reconciliar a decisão canônica; a
      // projeção/cache do usuário não substitui resposta do backend em erro.
      return ageEligibility.reconcileTrustedStateOncePerSession$().pipe(
        map((decision): GuardResult =>
          isCurrentAdultAccountAdmissionProjection(decision) ? true : age()),
        catchError(() => of(age()))
      );
    }),
    catchError(() => of(terms()))
  );
};
