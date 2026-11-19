// src/app/register-module/data-access/register-flow.facade.ts
import { Injectable, Optional } from '@angular/core';

import { combineLatest, concat, Observable, of } from 'rxjs';
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
  ]).pipe(
    switchMap(([
      authReady,
      authUser,
      appUser,
    ]) => {
      const uid = authUser?.uid ?? null;
      const user = appUser && uid && appUser.uid === uid ? appUser : null;
      const emailVerified = authUser?.emailVerified === true;
      const termsAccepted =
        isCurrentLegalAcceptanceSatisfied(user?.acceptedTerms);

      const resolve = (ageEligibilityAllowed: boolean, passwordRequired = false) => {
        const state: RegisterFlowAccessState = {
          authReady: authReady === true,
          uid,
          email: authUser?.email ?? user?.email ?? null,
          emailVerified,
          userResolved: !uid || appUser === null || user !== null,
          userExists: user !== null,
          termsAccepted,
          ageEligibilityAllowed,
          profileCompleted: user?.profileCompleted === true,
          passwordRequired,
        };

        return this.navigation.resolveVm(state);
      };

      const continueRegistration = () => {
        // Uma expiração posterior de elegibilidade não reinicia o cadastro.
        if (user?.profileCompleted === true) return of(resolve(true));

        if (!authReady || !uid || !emailVerified || !user || !termsAccepted) {
          return of(resolve(false));
        }

        return concat(
          this.ageEligibility.reconcileTrustedStateOncePerSession$().pipe(
            catchError(() => of(user.ageEligibility))
          ),
          this.ageEligibility.current$
        ).pipe(map(ageState => resolve(isCurrentAdultAccountAdmissionProjection(ageState))));
      };

      if (!authReady || !uid || !emailVerified || !this.emailLink || !isEmailLinkPreviewUid(uid)) {
        return continueRegistration();
      }

      return this.emailLink.passwordRequired$(uid).pipe(
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
