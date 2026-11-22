// src/app/register-module/data-access/register-flow.facade.ts
import { Injectable, Optional } from '@angular/core';

import { combineLatest, concat, EMPTY, Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
} from 'rxjs/operators';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { AgeEligibilityService } from 'src/app/core/services/compliance/age-eligibility.service';
import {
  isCurrentAdultAccountAdmissionProjection,
} from 'src/app/core/services/compliance/trusted-adult-age-assurance.policy';
import { isCurrentLegalAcceptanceSatisfied } from 'src/app/core/services/compliance/terms-acceptance.service';
import {
  EmailLinkRegistrationService, isEmailLinkPreviewUid,
} from 'src/app/core/services/autentication/register/email-link-registration.service';

import { normalizeUserAccountLifecycleStatus } from '@core/services/autentication/auth/account-lifecycle.policy';
import { RegisterNavigationService } from './register-navigation.service';
import {
  RegisterFlowAccessState,
  RegisterFlowVm,
  isRegistrationRestricted,
} from './register-flow.model';

@Injectable({ providedIn: 'root' })
export class RegisterFlowFacade {
  readonly vm$: Observable<RegisterFlowVm> = combineLatest([
    this.session.ready$,
    this.session.authUser$,
    this.currentUser.user$,
  ]).pipe(
    map(([
      authReady,
      authUser,
      appUser,
    ]) => {
      const uid = authUser?.uid ?? null;
      const user = appUser && uid && appUser.uid === uid ? appUser : null;
      return {
        authReady: authReady === true,
        uid,
        email: authUser?.email ?? user?.email ?? null,
        emailVerified: authUser?.emailVerified === true,
        userResolved: !uid || user !== null || (appUser === null && this.currentUser.isMissingForUid(uid)),
        userExists: user !== null,
        termsAccepted: isCurrentLegalAcceptanceSatisfied(user?.acceptedTerms),
        profileCompleted: user?.profileCompleted === true,
        accountStatus: user ? normalizeUserAccountLifecycleStatus(user) : undefined,
      };
    }),
    // A consulta da autoridade etária pode atualizar users/{uid}. Mudanças
    // na projeção são observadas em current$ e não devem cancelar a consulta.
    distinctUntilChanged((previous, current) =>
      previous.authReady === current.authReady &&
      previous.uid === current.uid &&
      previous.email === current.email &&
      previous.emailVerified === current.emailVerified &&
      previous.userResolved === current.userResolved &&
      previous.userExists === current.userExists &&
      previous.termsAccepted === current.termsAccepted &&
      previous.accountStatus === current.accountStatus &&
      previous.profileCompleted === current.profileCompleted
    ),
    switchMap((state) => {
      const { authReady, uid, emailVerified, userExists, termsAccepted, profileCompleted } = state;
      const resolve = (ageEligibilityAllowed: boolean, passwordRequired = false) => {
        const access: RegisterFlowAccessState = {
          ...state,
          ageEligibilityAllowed,
          passwordRequired,
        };

        return this.navigation.resolveVm(access);
      };

      const continueRegistration = () => {
        // Uma expiração posterior de elegibilidade não reinicia o cadastro.
        if (profileCompleted || isRegistrationRestricted(state.accountStatus)) return of(resolve(profileCompleted));

        if (!authReady || !uid || !emailVerified || !userExists || !termsAccepted) {
          return of(resolve(false));
        }

        return concat(
          this.ageEligibility.reconcileTrustedStateOncePerSession$().pipe(
            catchError(() => EMPTY)
          ),
          this.ageEligibility.current$
        ).pipe(map(ageState => resolve(isCurrentAdultAccountAdmissionProjection(ageState))));
      };

      if (!authReady || !uid || !emailVerified || !this.emailLink || !isEmailLinkPreviewUid(uid)) {
        return continueRegistration();
      }

      return this.emailLink.watchPasswordRequired$(uid).pipe(
        catchError(() => of(true)),
        switchMap(required => required ? of(resolve(false, true)) : continueRegistration()),
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
    private readonly navigation: RegisterNavigationService,
    @Optional() private readonly emailLink?: EmailLinkRegistrationService,
  ) {}

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
      a.accountStatus === b.accountStatus &&
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
