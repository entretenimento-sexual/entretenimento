import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { EMPTY, Observable, of } from 'rxjs';
import {
  catchError,
  filter,
  finalize,
  map,
  switchMap,
  take,
  timeout,
} from 'rxjs/operators';

import {
  IUserAgeEligibility,
} from 'src/app/core/interfaces/iuser-dados';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { RegisterFlowFacade } from 'src/app/register-module/data-access/register-flow.facade';
import {
  isRegistrationConfirmationUncertain,
  isRegistrationSessionChange,
  REGISTRATION_ACTION_TIMEOUT_MS,
} from 'src/app/register-module/data-access/register-action.policy';
import { RegisterProgressComponent } from 'src/app/register-module/register-progress/register-progress.component';
import { LogoutService } from 'src/app/core/services/autentication/auth/logout.service';
import {
  AgeEligibilityService,
} from 'src/app/core/services/compliance/age-eligibility.service';
import {
  isCurrentAdultAccountAdmissionProjection,
  isCurrentTrustedAdultAgeProjection,
} from 'src/app/core/services/compliance/trusted-adult-age-assurance.policy';
import { PageHeaderComponent } from 'src/app/shared/page-header/page-header.component';

interface AgeVerificationPageVm {
  state: IUserAgeEligibility;
  accessAllowed: boolean;
  verified: boolean;
  selfDeclared: boolean;
  expired: boolean;
  deniedUnderage: boolean;
  reviewRequired: boolean;
}

interface PageFeedback {
  tone: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
}

@Component({
  selector: 'app-age-verification-page',
  standalone: true,
  imports: [CommonModule, RouterModule, PageHeaderComponent, RegisterProgressComponent],
  templateUrl: './age-verification-page.component.html',
  styleUrls: ['./age-verification-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgeVerificationPageComponent implements OnInit {
  private readonly ageEligibility = inject(AgeEligibilityService);
  private readonly logout = inject(LogoutService);
  private readonly session = inject(AuthSessionService);
  private readonly registerFlow = inject(RegisterFlowFacade);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private continued = false;
  protected pageUid: string | undefined;

  readonly processing = signal(false);
  readonly reconciling = signal(true);
  readonly continuing = signal(false);
  readonly feedback = signal<PageFeedback | null>(null);
  readonly ageRecheckRequired = signal(false);

  readonly vm$: Observable<AgeVerificationPageVm> =
    this.ageEligibility.current$.pipe(
      map((state) => ({
        state,
        accessAllowed: isCurrentAdultAccountAdmissionProjection(state),
        verified: isCurrentTrustedAdultAgeProjection(state),
        selfDeclared: state.status === 'SELF_DECLARED_ADULT',
        expired: state.status === 'EXPIRED',
        deniedUnderage: state.status === 'DENIED_UNDERAGE',
        reviewRequired: state.status === 'REVIEW_REQUIRED',
      }))
    );

  ngOnInit(): void {
    this.pageUid = this.session.currentAuthUser?.uid;
    this.recheckAge();
  }

  recheckAge(forceRefresh = false): void {
    if (this.processing() || this.continuing()) return;
    if (!this.isCurrentAccount()) {
      this.reconciling.set(false);
      this.reportSessionChange();
      return;
    }
    this.reconciling.set(true);
    this.feedback.set(null);
    // Não navegar com projeção antiga antes da reconciliação canônica.
    const state$ = forceRefresh
      ? this.ageEligibility.refreshTrustedSources$().pipe(
        switchMap(() => this.ageEligibility.getCurrentOnce$())
      )
      : this.ageEligibility.reconcileTrustedStateOncePerSession$();
    state$
      .pipe(
        take(1),
        timeout({ first: REGISTRATION_ACTION_TIMEOUT_MS }),
        catchError((error: unknown) => {
          if (!this.isCurrentAccount() || isRegistrationSessionChange(error)) {
            this.reportSessionChange();
            return of(null);
          }
          this.ageRecheckRequired.set(true);
          this.feedback.set({
            tone: 'error',
            title: 'Não foi possível consultar sua elegibilidade etária',
            message: 'Não conseguimos confirmar o estado registrado da sua conta. Verifique a conexão e tente novamente.',
          });
          return of(null);
        }),
        finalize(() => this.reconciling.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((state) => {
        if (state) this.ageRecheckRequired.set(false);
        if (state && isCurrentAdultAccountAdmissionProjection(state)) {
          this.continueAfterAgeStep();
        }
      });
  }

  confirmAdult(): void {
    if (this.processing() || this.reconciling() || this.ageRecheckRequired()) return;
    if (!this.isCurrentAccount()) {
      this.reportSessionChange();
      return;
    }
    this.processing.set(true);
    this.feedback.set(null);
    this.ageEligibility.acceptSelfDeclaration$().pipe(
      take(1),
      switchMap(() => this.ageEligibility.getCurrentOnce$()),
      timeout({ first: REGISTRATION_ACTION_TIMEOUT_MS }),
      catchError((error: unknown) => {
        if (!this.isCurrentAccount() || isRegistrationSessionChange(error)) {
          this.reportSessionChange();
          return EMPTY;
        }
        if (isRegistrationConfirmationUncertain(error)) {
          this.ageRecheckRequired.set(true);
          this.feedback.set({
            tone: 'warning',
            title: 'Confirmação ainda pendente',
            message: 'Assim que a conexão estiver estável, consulte a situação da conta antes de confirmar novamente.',
          });
          return EMPTY;
        }
        this.feedback.set({
          tone: 'error',
          title: 'Não foi possível registrar a confirmação 18+',
          message: 'Confira sua conexão e o estado da conta antes de tentar novamente.',
        });
        return EMPTY;
      }),
      finalize(() => this.processing.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((state) => {
      if (!this.isCurrentAccount()) {
        this.reportSessionChange();
        return;
      }
      if (isCurrentAdultAccountAdmissionProjection(state)) {
        this.feedback.set({
          tone: 'success',
          title: 'Maioridade registrada',
          message: 'Sua confirmação foi vinculada à conta.',
        });
        this.continueAfterAgeStep();
      } else {
        this.feedback.set({
          tone: 'warning',
          title: 'Elegibilidade ainda pendente',
          message: 'Sua conta ainda não possui uma decisão etária que permita continuar.',
        });
      }
    });
  }

  goToNotifications(): void {
    void this.router.navigate(['/notificacoes']);
  }

  goToAccount(): void {
    void this.router.navigate(['/conta']);
  }

  logoutCurrentSession(): void {
    if (this.processing()) return;

    this.processing.set(true);

    this.logout.logout$()
      .pipe(
        take(1),
        catchError(() => EMPTY),
        finalize(() => this.processing.set(false))
      )
      .subscribe();
  }

  continueAfterAgeStep(): void {
    if (this.continued) return;
    if (!this.isCurrentAccount()) {
      this.reportSessionChange();
      return;
    }

    this.continued = true;
    this.continuing.set(true);
    const redirectTo = this.safeRedirectTo(
      this.route.snapshot.queryParamMap.get('redirectTo')
    );

    this.registerFlow.vm$.pipe(
      filter((vm) =>
        vm.uid === this.pageUid &&
        vm.authReady &&
        vm.userResolved &&
        vm.currentStep !== 'loading' &&
        vm.currentStep !== 'ageVerification'
      ),
      take(1),
      timeout({ first: 5000 }),
      switchMap((vm) => {
        if (!this.isCurrentAccount()) {
          this.continued = false;
          this.reportSessionChange();
          return EMPTY;
        }
        const target = vm.currentStep === 'preferences'
          ? redirectTo ?? '/dashboard/principal'
          : vm.nextRoute;
        const destination = this.router.parseUrl(target);
        if (redirectTo && vm.currentStep !== 'preferences') {
          destination.queryParams = { ...destination.queryParams, redirectTo };
        }
        return this.router.navigateByUrl(this.router.serializeUrl(destination), { replaceUrl: true });
      }),
      timeout({ first: REGISTRATION_ACTION_TIMEOUT_MS }),
      catchError(() => {
        if (this.isCurrentAccount()) {
          this.reportNavigationFailure();
        } else {
          this.continued = false;
          this.reportSessionChange();
        }
        return EMPTY;
      }),
      finalize(() => this.continuing.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((navigated) => {
      if (!navigated) this.reportNavigationFailure();
    });
  }

  private isCurrentAccount(): boolean {
    return Boolean(this.pageUid) &&
      !this.session.isTerminatingSnapshot &&
      this.session.currentAuthUser?.uid === this.pageUid;
  }

  private reportSessionChange(): void {
    this.feedback.set({
      tone: 'warning',
      title: 'A sessão mudou',
      message: 'Recarregue a página para retomar o cadastro com a conta ativa.',
    });
  }

  private reportNavigationFailure(): void {
    this.continued = false;
    this.feedback.set({
      tone: 'error',
      title: 'Não foi possível continuar',
      message: 'Sua confirmação permanece registrada. Use Continuar para tentar abrir a próxima etapa.',
    });
  }

  private safeRedirectTo(value: string | null): string | null {
    const candidate = String(value ?? '').trim();

    if (
      !candidate.startsWith('/') ||
      candidate.startsWith('//') ||
      candidate.includes('://') ||
      candidate.startsWith('/login') ||
      candidate.startsWith('/register') ||
      candidate.startsWith('/adulto/')
    ) {
      return null;
    }

    return candidate;
  }
}
