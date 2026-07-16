// src/app/register-module/data-access/register-flow.facade.ts
import { Injectable } from '@angular/core';

import { combineLatest, Observable } from 'rxjs';
import { distinctUntilChanged, map, shareReplay } from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { AdultConsentService } from 'src/app/core/services/compliance/adult-consent.service';
import { hasAcceptedCurrentTerms } from 'src/app/core/services/compliance/terms-acceptance.service';

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
    map(([authReady, authUser, appUser, adultConsentAccepted]) => {
      const user = this.asResolvedUser(appUser);

      const state: RegisterFlowAccessState = {
        authReady: authReady === true,
        uid: authUser?.uid ?? user?.uid ?? null,
        email: authUser?.email ?? user?.email ?? null,
        emailVerified:
          authUser?.emailVerified === true || user?.emailVerified === true,
        userResolved: appUser !== undefined,
        userExists: user !== null,
        termsAccepted: hasAcceptedCurrentTerms(user?.acceptedTerms),
        profileCompleted: user?.profileCompleted === true,
        adultConsentAccepted: adultConsentAccepted === true,
        initialAdultConsentRequired:
          user?.initialAdultConsentRequired === true,
      };

      return this.navigation.resolveVm(state);
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
