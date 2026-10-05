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
  distinctUntilChanged,
  finalize,
  map,
  switchMap,
  take,
} from 'rxjs/operators';

import {
  IUserAgeEligibility,
} from 'src/app/core/interfaces/iuser-dados';
import { LogoutService } from 'src/app/core/services/autentication/auth/logout.service';
import {
  AgeEligibilityService,
} from 'src/app/core/services/compliance/age-eligibility.service';
import {
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
  imports: [CommonModule, RouterModule, PageHeaderComponent],
  templateUrl: './age-verification-page.component.html',
  styleUrls: ['./age-verification-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgeVerificationPageComponent implements OnInit {
  private readonly ageEligibility = inject(AgeEligibilityService);
  private readonly logout = inject(LogoutService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private continued = false;

  readonly processing = signal(false);
  readonly reconciling = signal(true);
  readonly feedback = signal<PageFeedback | null>(null);

  readonly vm$: Observable<AgeVerificationPageVm> =
    this.ageEligibility.current$.pipe(
      map((state) => ({
        state,
        accessAllowed: isCurrentTrustedAdultAgeProjection(state),
        verified: isCurrentTrustedAdultAgeProjection(state),
        selfDeclared: state.status === 'SELF_DECLARED_ADULT',
        expired: state.status === 'EXPIRED',
        deniedUnderage: state.status === 'DENIED_UNDERAGE',
        reviewRequired: state.status === 'REVIEW_REQUIRED',
      }))
    );

  ngOnInit(): void {
    this.ageEligibility.reconcileTrustedStateOncePerSession$()
      .pipe(
        take(1),
        catchError(() => of(null)),
        finalize(() => this.reconciling.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.ageEligibility.current$
      .pipe(
        map((state) => isCurrentTrustedAdultAgeProjection(state)),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((registrationAgeStepSatisfied) => {
        if (registrationAgeStepSatisfied && !this.continued) {
          this.continued = true;
          this.continueAfterAgeStep();
        }
      });
  }

  requestVerification(): void {
    if (this.processing()) return;

    this.processing.set(true);
    this.feedback.set({
      tone: 'info',
      title: 'Solicitando verificação',
      message:
        'Estamos abrindo a verificação confiável de maioridade da sua conta.',
    });

    this.ageEligibility.requestInitialReview$()
      .pipe(
        take(1),
        switchMap((result) => {
          if (result.status !== 'VERIFIED_ADULT') return of(result);

          return this.ageEligibility.refreshTrustedSources$().pipe(
            map(() => result),
            catchError(() => of(result))
          );
        }),
        catchError(() => {
          this.feedback.set({
            tone: 'error',
            title: 'Não foi possível solicitar a verificação',
            message:
              'Tente novamente em alguns instantes ou consulte o status da conta.',
          });
          return EMPTY;
        }),
        finalize(() => this.processing.set(false))
      )
      .subscribe((result) => {
        if (result.status === 'VERIFIED_ADULT') {
          this.feedback.set({
            tone: 'success',
            title: 'Maioridade verificada',
            message: 'A próxima etapa será aberta automaticamente.',
          });
          return;
        }

        this.feedback.set({
          tone: 'warning',
          title: 'Verificação em análise',
          message:
            'A solicitação foi registrada. Não é necessário repetir sua declaração de maioridade.',
        });
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
        catchError(() => {
          this.feedback.set({
            tone: 'error',
            title: 'Não foi possível sair da conta',
            message: 'Tente novamente em alguns instantes.',
          });
          return EMPTY;
        }),
        finalize(() => this.processing.set(false))
      )
      .subscribe();
  }

  private continueAfterAgeStep(): void {
    const redirectTo =
      this.safeRedirectTo(
        this.route.snapshot.queryParamMap.get('redirectTo')
      ) ?? '/dashboard/principal';

    void this.router.navigate(['/adulto/confirmar'], {
      replaceUrl: true,
      queryParams: { redirectTo },
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
