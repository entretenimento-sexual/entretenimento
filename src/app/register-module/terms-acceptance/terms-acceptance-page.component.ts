import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormControl,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { EMPTY, Observable, combineLatest, defer, of, throwError } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  finalize,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
  timeout,
} from 'rxjs/operators';

import { LogoutService } from 'src/app/core/services/autentication/auth/logout.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import {
  PLATFORM_LEGAL_MANIFEST,
  TERMS_ACCEPTANCE_VERSION,
  TermsAcceptanceService,
  hasAcceptedCurrentTerms,
} from 'src/app/core/services/compliance/terms-acceptance.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { RegisterFlowFacade } from '../data-access/register-flow.facade';
import {
  isRegistrationConfirmationUncertain,
  isRegistrationSessionChange,
  REGISTRATION_ACTION_TIMEOUT_MS,
} from '../data-access/register-action.policy';
import { REGISTRATION_COMPLETION_ROUTE, resolveRegistrationReturnUrl, type RegisterFlowVm } from '../data-access/register-flow.model';
import { RegisterProgressComponent } from '../register-progress/register-progress.component';

@Component({
  selector: 'app-terms-acceptance-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule, RegisterProgressComponent],
  templateUrl: './terms-acceptance-page.component.html',
  styleUrls: ['./terms-acceptance-page.component.css'],
})
export class TermsAcceptancePageComponent {
  private readonly FLOW_RESOLUTION_TIMEOUT_MS = 5000;
  private readonly destroyRef = inject(DestroyRef);
  protected readonly pageUid: string | null;

  readonly legalManifest = PLATFORM_LEGAL_MANIFEST;

  /**
   * Uma única manifestação contratual cobre o aceite dos Termos e a ciência de
   * que a Política de Privacidade foi disponibilizada. A etapa etária canônica permanece responsável pela admissão 18+, sem
   * consentimento adulto redundante.
   */
  readonly termsConfirmation = new FormControl(false, {
    nonNullable: true,
    validators: [Validators.requiredTrue],
  });

  readonly isMaterialUpdate$: Observable<boolean>;
  readonly currentTermsAccepted$: Observable<boolean>;
  protected readonly registrationNickname$: Observable<string | null>;
  readonly isSaving = signal(false);
  readonly resumingSignupAcceptance = signal(false);
  readonly acceptanceConfirmed = signal(false);
  readonly operationMessage = signal('');

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly termsAcceptance: TermsAcceptanceService,
    private readonly registerFlow: RegisterFlowFacade,
    private readonly currentUser: CurrentUserStoreService,
    private readonly logout: LogoutService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService,
  ) {
    this.pageUid = this.currentUser.getLoggedUserUIDSnapshot();
    this.registrationNickname$ = this.currentUser.user$.pipe(
      map(user => user && user.uid === this.pageUid ? user.nickname?.trim() || null : null),
      distinctUntilChanged(),
    );
    this.currentTermsAccepted$ = this.currentUser.user$.pipe(
      map(user => !!user && user.uid === this.pageUid && hasAcceptedCurrentTerms(user.acceptedTerms)),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.isMaterialUpdate$ = combineLatest([
      this.currentUser.user$,
      this.route.queryParamMap,
    ]).pipe(
      map(([user, queryParams]) => {
        const record = user?.acceptedTerms;

        if (hasAcceptedCurrentTerms(record)) {
          return false;
        }

        const previousVersion = String(record?.version ?? '').trim();
        const routedAsUpdate =
          queryParams.get('reason') === 'material_terms_update_required';

        // Histórico sem versão também exige novo aceite explícito.
        return routedAsUpdate || (
          record?.accepted === true &&
          (!previousVersion ||
            previousVersion !== TERMS_ACCEPTANCE_VERSION ||
            record.acknowledgedPrivacyNotice !== true)
        );
      }),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.redirectRecognizedAcceptance();
    if (this.pageUid && !this.acceptanceConfirmed() &&
        this.termsAcceptance.hasPendingSignupAcceptance(this.pageUid)) {
      this.resumingSignupAcceptance.set(true);
      this.submitAcceptance(this.pageUid, this.termsAcceptance.acceptForUser$(this.pageUid, {
        signupAdultDeclaration: true,
      }));
    }
  }

  accept(): void {
    if (this.isSaving()) {
      return;
    }

    const uid = this.pageUid;
    if (!uid || this.currentUser.getLoggedUserUIDSnapshot() !== uid) {
      this.operationMessage.set('A sessão mudou. Entre na conta que deseja usar para retomar o cadastro.');
      return;
    }

    if (!this.acceptanceConfirmed() && !this.acknowledgementsValid()) {
      this.markAcknowledgementsTouched();
      this.errorNotifier.showWarning(
        'Confirme o aceite dos Termos de Uso e a ciência da Política de Privacidade.'
      );
      return;
    }

    const accepted$ = this.acceptanceConfirmed()
      ? of({ uid })
      : this.termsAcceptance.acceptCurrentTerms$(uid);
    this.submitAcceptance(uid, accepted$);
  }

  private submitAcceptance(uid: string, accepted$: Observable<{ uid: string }>): void {
    this.isSaving.set(true);
    this.operationMessage.set('');

    accepted$
      .pipe(
        switchMap((result) => {
          if (uid !== result.uid || this.currentUser.getLoggedUserUIDSnapshot() !== uid) {
            return throwError(() => Object.assign(new Error('A sessão mudou.'), {
              code: 'auth/session-changed',
            }));
          }
          this.acceptanceConfirmed.set(true);
          return this.navigateAfterAcceptance(uid);
        }),
        catchError((error: unknown) => {
          if (this.currentUser.getLoggedUserUIDSnapshot() !== uid || isRegistrationSessionChange(error)) {
            this.operationMessage.set('A sessão mudou. Entre na conta que deseja usar para retomar o cadastro.');
          } else if (this.acceptanceConfirmed()) {
            this.reportNavigationFailure(error);
          } else {
            this.operationMessage.set(isRegistrationConfirmationUncertain(error)
              ? 'Seu aceite pode já estar registrado. Verifique a conexão e tente novamente para confirmar.'
              : 'Não foi possível registrar seu aceite agora. Verifique a conexão e tente novamente.');
          }
          return EMPTY;
        }),
        finalize(() => {
          this.resumingSignupAcceptance.set(false);
          this.isSaving.set(false);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  decline(): void {
    if (this.isSaving()) {
      return;
    }

    this.isSaving.set(true);
    if (!this.acceptanceConfirmed()) {
      if (this.pageUid && this.currentUser.getLoggedUserUIDSnapshot() === this.pageUid) {
        this.termsAcceptance.clearPendingSignupAcceptance(this.pageUid);
      }
      this.errorNotifier.showWarning(
        'Sem aceitar os Termos de Uso vigentes, a conta não pode continuar usando os recursos da plataforma.',
        4200
      );
    }

    this.logout.logout$()
      .pipe(
        take(1),
        catchError(() => EMPTY),
        finalize(() => {
          this.isSaving.set(false);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  acknowledgementsValid(): boolean {
    return this.termsConfirmation.valid;
  }

  isControlInvalid(control: FormControl<boolean>): boolean {
    return control.touched && control.invalid;
  }

  private markAcknowledgementsTouched(): void {
    this.termsConfirmation.markAsTouched();
  }

  private navigateAfterAcceptance(uid: string): Observable<boolean> {
    return this.registerFlow.vm$.pipe(
      filter((vm) => vm.uid === uid && vm.termsAccepted &&
        vm.currentStep !== 'loading' && vm.currentStep !== 'termsAcceptance'),
      take(1),
      timeout({ first: this.FLOW_RESOLUTION_TIMEOUT_MS }),
      switchMap((vm) => defer(() => {
        if (this.currentUser.getLoggedUserUIDSnapshot() !== uid) {
          throw Object.assign(new Error('A sessão mudou.'), { code: 'auth/session-changed' });
        }
        return this.router.navigateByUrl(this.resolveNextRoute(vm), { replaceUrl: true });
      }).pipe(timeout({ first: REGISTRATION_ACTION_TIMEOUT_MS }))),
      tap((navigated) => {
        if (!navigated || this.router.url.split(/[?#]/)[0] === '/register/aceitar-termos') {
          throw new Error('A próxima etapa do cadastro não abriu.');
        }
      })
    );
  }

  private reportNavigationFailure(error: unknown): void {
    this.operationMessage.set(
      'Seu aceite foi registrado. Use Continuar cadastro para tentar abrir a próxima etapa.'
    );
    this.globalErrorHandler.handleError(Object.assign(
      new Error('Falha ao avançar após registrar o aceite.', { cause: error }),
      { context: 'TermsAcceptancePageComponent.navigateAfterAcceptance', skipUserNotification: true }
    ));
  }

  private redirectRecognizedAcceptance(): void {
    this.currentTermsAccepted$.pipe(
      filter((accepted) => accepted),
      take(1),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => {
      this.acceptanceConfirmed.set(true);
      if (!this.isSaving()) this.accept();
    });
  }

  private resolveNextRoute(vm: RegisterFlowVm): string {
    const redirectTo = resolveRegistrationReturnUrl(this.route.snapshot.queryParamMap.get('redirectTo'));

    switch (vm.currentStep) {
      case 'emailVerification':
        return '/register/welcome?autocheck=1';

      case 'profileCompletion':
        return this.buildProfileCompletionRoute(
          redirectTo ?? REGISTRATION_COMPLETION_ROUTE
        );

      case 'ageVerification':
        return redirectTo
          ? `/adulto/verificar-idade?redirectTo=${encodeURIComponent(redirectTo)}`
          : '/adulto/verificar-idade';

      case 'preferences':
        return redirectTo ?? vm.nextRoute ?? REGISTRATION_COMPLETION_ROUTE;

      case 'loading':
      case 'signup':
      case 'termsAcceptance':
      default:
        return vm.nextRoute && vm.nextRoute !== '/register/aceitar-termos'
          ? vm.nextRoute
          : this.buildProfileCompletionRoute(
              redirectTo ?? REGISTRATION_COMPLETION_ROUTE
            );
    }
  }

  private buildProfileCompletionRoute(redirectTo: string): string {
    return `/register/finalizar-cadastro?reason=profile_incomplete&redirectTo=${encodeURIComponent(redirectTo)}`;
  }
}
