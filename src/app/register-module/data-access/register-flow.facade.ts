// src/app/register-module/data-access/register-flow.facade.ts
import { Injectable } from '@angular/core';

import { combineLatest, Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
} from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { AdultConsentService } from 'src/app/core/services/compliance/adult-consent.service';
import { AgeEligibilityService } from 'src/app/core/services/compliance/age-eligibility.service';
import {
  isCurrentTrustedAdultAgeProjection,
} from 'src/app/core/services/compliance/trusted-adult-age-assurance.policy';
import { isCurrentLegalAcceptanceSatisfied } from 'src/app/core/services/compliance/terms-acceptance.service';

import { RegisterNavigationService } from './register-navigation.service';
import {
  RegisterFlowAccessState,
  RegisterFlowVm,
} from './register-flow.model';

@Injectable({ providedIn: 'root' })
export class RegisterFlowFacade {
  readonly vm$: Observable<RegisterFlowVm> = combineLatest([
    this.session.ready$,
    this.session.authUser$,
    this.currentUser.user$,
    this.adultConsent.currentConsentAccepted$,
  ]).pipe(
    switchMap(([
      authReady,
      authUser,
      appUser,
      adultConsentAccepted,
    ]) => {
      const user = this.asResolvedUser(appUser);
      const uid = authUser?.uid ?? user?.uid ?? null;
      const emailVerified =
        authUser?.emailVerified === true || user?.emailVerified === true;
      const termsAccepted =
        isCurrentLegalAcceptanceSatisfied(user?.acceptedTerms);

      const resolve = (ageEligibilityAllowed: boolean) => {
        const state: RegisterFlowAccessState = {
          authReady: authReady === true,
          uid,
          email: authUser?.email ?? user?.email ?? null,
          emailVerified,
          userResolved: appUser !== undefined,
          userExists: user !== null,
          termsAccepted,
          ageEligibilityAllowed,
          profileCompleted: user?.profileCompleted === true,
          adultConsentAccepted: adultConsentAccepted === true,
          initialAdultConsentRequired:
            user?.initialAdultConsentRequired === true,
        };

        return this.navigation.resolveVm(state);
      };

      const shouldReconcile =
        authReady === true &&
        !!uid &&
        emailVerified &&
        user !== null &&
        termsAccepted;

      if (!shouldReconcile) {
        return of(resolve(false));
      }

      return this.ageEligibility.reconcileTrustedStateOncePerSession$().pipe(
        map((ageState) =>
          resolve(isCurrentTrustedAdultAgeProjection(ageState))
        ),
        catchError(() =>
          of(resolve(isCurrentTrustedAdultAgeProjection(user?.ageEligibility)))
        )
      );
    }),
    distinctUntilChanged((a, b) => this.vmEquals(a, b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly nextRoute$: Observable<string> = this.vm$.pipe(
    map((vm) => vm.nextRoute),
    distinctUntilChanged()
  );

  constructor(
    private readonly session: AuthSessionService,
    private readonly currentUser: CurrentUserStoreService,
    private readonly ageEligibility: AgeEligibilityService,
    private readonly adultConsent: AdultConsentService,
    private readonly navigation: RegisterNavigationService
  ) {}

  private asResolvedUser(value: IUserDados | null | undefined): IUserDados | null {
    return value && value !== null ? value : null;
  }

  private vmEquals(a: RegisterFlowVm, b: RegisterFlowVm): boolean {
    return (
      a.authReady === b.authReady &&
      a.uid === b.uid &&
      a.email === b.email &&
      a.emailVerified === b.emailVerified &&
      a.userResolved === b.userResolved &&
      a.userExists === b.userExists &&
      a.termsAccepted === b.termsAccepted &&
      a.ageEligibilityAllowed === b.ageEligibilityAllowed &&
      a.profileCompleted === b.profileCompleted &&
      a.adultConsentAccepted === b.adultConsentAccepted &&
      a.initialAdultConsentRequired === b.initialAdultConsentRequired &&
      a.currentStep === b.currentStep &&
      a.nextRoute === b.nextRoute &&
      a.progress === b.progress &&
      a.canContinue === b.canContinue &&
      a.primaryActionLabel === b.primaryActionLabel &&
      a.secondaryActionLabel === b.secondaryActionLabel &&
      a.blockingMessage === b.blockingMessage
    );
  }
}
