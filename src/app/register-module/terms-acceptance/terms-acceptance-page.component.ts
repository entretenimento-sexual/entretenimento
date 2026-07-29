import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import {
  FormControl,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { EMPTY, of } from 'rxjs';
import {
  catchError,
  filter,
  finalize,
  map,
  switchMap,
  take,
  timeout,
} from 'rxjs/operators';

import { LogoutService } from 'src/app/core/services/autentication/auth/logout.service';
import {
  PLATFORM_LEGAL_MANIFEST,
  TermsAcceptanceService,
} from 'src/app/core/services/compliance/terms-acceptance.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { RegisterFlowFacade } from '../data-access/register-flow.facade';
import { RegisterFlowVm } from '../data-access/register-flow.model';

@Component({
  selector: 'app-terms-acceptance-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './terms-acceptance-page.component.html',
  styleUrls: ['./terms-acceptance-page.component.css'],
})
export class TermsAcceptancePageComponent {
  private readonly FLOW_RESOLUTION_TIMEOUT_MS = 5000;

  readonly legalManifest = PLATFORM_LEGAL_MANIFEST;

  readonly termsConfirmation = new FormControl(false, {
    nonNullable: true,
    validators: [Validators.requiredTrue],
  });

  readonly privacyAcknowledgement = new FormControl(false, {
    nonNullable: true,
    validators: [Validators.requiredTrue],
  });

  readonly adultAccessAcknowledgement = new FormControl(false, {
    nonNullable: true,
    validators: [Validators.requiredTrue],
  });

  readonly isSaving = signal(false);

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly termsAcceptance: TermsAcceptanceService,
    private readonly registerFlow: RegisterFlowFacade,
    private readonly logout: LogoutService,
    private readonly errorNotifier: ErrorNotificationService,
  ) {}

  accept(): void {
    if (this.isSaving()) {
      return;
    }

    if (!this.acknowledgementsValid()) {
      this.markAcknowledgementsTouched();
      this.errorNotifier.showWarning(
        'Confirme separadamente os Termos de Uso, a ciência da Política de Privacidade e a condição de acesso adulto.'
      );
      return;
    }

    this.isSaving.set(true);

    this.termsAcceptance.acceptCurrentTerms$()
      .pipe(
        switchMap(({ uid }) =>
          this.registerFlow.vm$.pipe(
            filter(
              (vm) =>
                vm.uid === uid &&
                vm.termsAccepted === true &&
                vm.currentStep !== 'termsAcceptance'
            ),
            take(1),
            timeout({
              first: this.FLOW_RESOLUTION_TIMEOUT_MS,
              with: () => of(null as RegisterFlowVm | null),
            }),
            map((vm) => this.resolveNextRoute(vm, uid))
          )
        ),
        catchError(() => {
          this.errorNotifier.showError(
            'Não foi possível registrar seu aceite agora. Verifique a conexão e tente novamente.'
          );
          return EMPTY;
        }),
        finalize(() => {
          this.isSaving.set(false);
        })
      )
      .subscribe((target) => {
        this.router.navigateByUrl(target, { replaceUrl: true }).catch(() => {
          this.router
            .navigate(['/register/finalizar-cadastro'], {
              replaceUrl: true,
              queryParams: {
                reason: 'profile_incomplete',
              },
            })
            .catch(() => undefined);
        });
      });
  }

  decline(): void {
    if (this.isSaving()) {
      return;
    }

    this.isSaving.set(true);
    this.errorNotifier.showWarning(
      'Sem aceitar os Termos de Uso vigentes, a conta não pode continuar usando os recursos da plataforma.',
      4200
    );

    this.logout.logout$()
      .pipe(
        take(1),
        catchError(() => {
          this.errorNotifier.showError(
            'Não foi possível encerrar sua sessão. Tente novamente.'
          );
          return EMPTY;
        }),
        finalize(() => {
          this.isSaving.set(false);
        })
      )
      .subscribe();
  }

  acknowledgementsValid(): boolean {
    return this.termsConfirmation.valid &&
      this.privacyAcknowledgement.valid &&
      this.adultAccessAcknowledgement.valid;
  }

  isControlInvalid(control: FormControl<boolean>): boolean {
    return control.touched && control.invalid;
  }

  private markAcknowledgementsTouched(): void {
    this.termsConfirmation.markAsTouched();
    this.privacyAcknowledgement.markAsTouched();
    this.adultAccessAcknowledgement.markAsTouched();
  }

  private resolveNextRoute(
    vm: RegisterFlowVm | null,
    uid: string
  ): string {
    const redirectTo = this.resolveSafeRedirectTo();
    const preferencesRoute = `/preferencias/editar/${encodeURIComponent(uid)}`;

    if (!vm) {
      return this.buildProfileCompletionRoute(
        redirectTo ?? preferencesRoute
      );
    }

    switch (vm.currentStep) {
      case 'emailVerification':
        return '/register/welcome?autocheck=1';

      case 'profileCompletion':
        return this.buildProfileCompletionRoute(
          redirectTo ?? preferencesRoute
        );

      case 'adultConsent':
        return redirectTo
          ? `/adulto/confirmar?redirectTo=${encodeURIComponent(redirectTo)}`
          : '/adulto/confirmar';

      case 'preferences':
        return redirectTo ?? vm.nextRoute ?? preferencesRoute;

      case 'loading':
      case 'signup':
      case 'termsAcceptance':
      default:
        return vm.nextRoute && vm.nextRoute !== '/register/aceitar-termos'
          ? vm.nextRoute
          : this.buildProfileCompletionRoute(
              redirectTo ?? preferencesRoute
            );
    }
  }

  private buildProfileCompletionRoute(redirectTo: string): string {
    return `/register/finalizar-cadastro?reason=profile_incomplete&redirectTo=${encodeURIComponent(redirectTo)}`;
  }

  private resolveSafeRedirectTo(): string | null {
    const value = String(
      this.route.snapshot.queryParamMap.get('redirectTo') ?? ''
    ).trim();

    if (
      !value ||
      !value.startsWith('/') ||
      value.startsWith('//') ||
      value.startsWith('/login') ||
      value.startsWith('/register') ||
      value.startsWith('/adulto/confirmar')
    ) {
      return null;
    }

    return value;
  }
}
