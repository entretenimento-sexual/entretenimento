import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import {
  FormControl,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { EMPTY, Observable, combineLatest, from, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  finalize,
  map,
  shareReplay,
  switchMap,
  take,
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

  /**
   * Uma única manifestação contratual cobre o aceite dos Termos e a ciência de
   * que a Política de Privacidade foi disponibilizada. O fluxo separado de
   * acesso adulto permanece responsável por declaração e verificação etária.
   */
  readonly termsConfirmation = new FormControl(false, {
    nonNullable: true,
    validators: [Validators.requiredTrue],
  });

  readonly isMaterialUpdate$: Observable<boolean>;
  readonly isSaving = signal(false);

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

        return routedAsUpdate || (
          record?.accepted === true &&
          !!previousVersion &&
          previousVersion !== TERMS_ACCEPTANCE_VERSION
        );
      }),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.redirectRecognizedAcceptance();
  }

  accept(): void {
    if (this.isSaving()) {
      return;
    }

    if (!this.acknowledgementsValid()) {
      this.markAcknowledgementsTouched();
      this.errorNotifier.showWarning(
        'Confirme o aceite dos Termos de Uso e a ciência da Política de Privacidade.'
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
        switchMap((target) => from(this.navigateAfterAcceptance(target))),
        finalize(() => {
          this.isSaving.set(false);
        })
      )
      .subscribe();
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
    return this.termsConfirmation.valid;
  }

  isControlInvalid(control: FormControl<boolean>): boolean {
    return control.touched && control.invalid;
  }

  private markAcknowledgementsTouched(): void {
    this.termsConfirmation.markAsTouched();
  }

  private async navigateAfterAcceptance(target: string): Promise<void> {
    let primaryError: unknown = null;

    try {
      const navigated = await this.router.navigateByUrl(target, {
        replaceUrl: true,
      });

      if (navigated) {
        return;
      }

      primaryError = new Error(
        `[TermsAcceptancePageComponent] Router recusou a navegação para ${target}.`
      );
    } catch (error) {
      primaryError = error;
    }

    try {
      const fallbackNavigated = await this.navigateToProfileCompletionFallback();

      if (fallbackNavigated) {
        return;
      }

      this.reportNavigationFailure(
        primaryError,
        new Error(
          '[TermsAcceptancePageComponent] Router recusou a navegação de fallback.'
        ),
        target
      );
    } catch (fallbackError) {
      this.reportNavigationFailure(primaryError, fallbackError, target);
    }
  }

  private navigateToProfileCompletionFallback(): Promise<boolean> {
    return this.router.navigate(['/register/finalizar-cadastro'], {
      replaceUrl: true,
      queryParams: {
        reason: 'profile_incomplete',
      },
    });
  }

  private reportNavigationFailure(
    primaryError: unknown,
    fallbackError: unknown,
    target: string
  ): void {
    try {
      const reportable = new Error(
        '[TermsAcceptancePageComponent] Falha ao avançar após registrar o aceite.'
      );

      (reportable as any).context = 'TermsAcceptancePageComponent.navigateAfterAcceptance';
      (reportable as any).target = target;
      (reportable as any).primaryError = primaryError;
      (reportable as any).fallbackError = fallbackError;
      (reportable as any).skipUserNotification = true;

      this.globalErrorHandler.handleError(reportable);
    } catch {
      // O diagnóstico não pode bloquear a recuperação do fluxo jurídico.
    }

    this.errorNotifier.showError(
      'Seu aceite foi registrado, mas não foi possível avançar. Recarregue a página e tente novamente.'
    );
  }

  /**
   * Se o usuário chegou aqui por um redirecionamento de reaceite que já não é
   * necessário, sai da rota imediatamente. Isso também corrige sessões que
   * ficaram presas em /register/aceitar-termos antes da compatibilidade v2 ser
   * restaurada.
   */
  private redirectRecognizedAcceptance(): void {
    this.currentUser.user$
      .pipe(
        filter((user) => user !== undefined),
        filter((user) => hasAcceptedCurrentTerms(user?.acceptedTerms)),
        take(1)
      )
      .subscribe(() => {
        const target = this.resolveSafeRedirectTo() ?? '/';

        this.router.navigateByUrl(target, { replaceUrl: true })
          .then((navigated) => {
            if (!navigated) {
              this.reportRecognizedAcceptanceNavigationFailure(
                new Error(
                  `[TermsAcceptancePageComponent] Router recusou a saída para ${target}.`
                ),
                target
              );
            }
          })
          .catch((error) => {
            this.reportRecognizedAcceptanceNavigationFailure(error, target);
          });
      });
  }

  private reportRecognizedAcceptanceNavigationFailure(
    error: unknown,
    target: string
  ): void {
    try {
      const reportable = error instanceof Error
        ? error
        : new Error(
            '[TermsAcceptancePageComponent] Falha ao sair da rota de termos já aceitos.'
          );

      (reportable as any).context = 'TermsAcceptancePageComponent.redirectRecognizedAcceptance';
      (reportable as any).target = target;
      (reportable as any).original = error;
      (reportable as any).skipUserNotification = true;

      this.globalErrorHandler.handleError(reportable);
    } catch {
      // O diagnóstico não deve quebrar uma sessão cujo aceite já é válido.
    }

    this.errorNotifier.showError(
      'Seu aceite já está válido, mas não foi possível continuar. Recarregue a página e tente novamente.'
    );
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
