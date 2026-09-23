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
import { EMPTY, Observable } from 'rxjs';
import {
  catchError,
  finalize,
  map,
  take,
} from 'rxjs/operators';

import {
  IUserAgeEligibility,
} from 'src/app/core/interfaces/iuser-dados';
import { LogoutService } from 'src/app/core/services/autentication/auth/logout.service';
import {
  AgeEligibilityService,
} from 'src/app/core/services/compliance/age-eligibility.service';

interface AgeVerificationPageVm {
  state: IUserAgeEligibility;
  accessAllowed: boolean;
  strongVerified: boolean;
  selfAttested: boolean;
  deniedUnderage: boolean;
  reviewRequired: boolean;
  legacyInitialReview: boolean;
  expired: boolean;
}

type FeedbackTone = 'info' | 'success' | 'warning' | 'error';

interface AgeVerificationFeedback {
  tone: FeedbackTone;
  title: string;
  message: string;
}

@Component({
  selector: 'app-age-verification-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
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

  readonly processing = signal(false);
  readonly feedback = signal<AgeVerificationFeedback | null>(null);

  readonly vm$: Observable<AgeVerificationPageVm> =
    this.ageEligibility.current$.pipe(
      map((state) => {
        const selfAttested =
          state.status === 'DECLARED_ADULT' &&
          state.assuranceLevel === 'SELF_ATTESTED';
        const strongVerified =
          state.status === 'VERIFIED_ADULT' &&
          state.assuranceLevel === 'VERIFIED';
        const reviewRequired = state.status === 'REVIEW_REQUIRED';

        return {
          state,
          accessAllowed: selfAttested || strongVerified,
          strongVerified,
          selfAttested,
          deniedUnderage: state.status === 'DENIED_UNDERAGE',
          reviewRequired,
          legacyInitialReview:
            reviewRequired &&
            state.source === 'INITIAL_VERIFICATION' &&
            state.method === 'MANUAL_REVIEW',
          expired: state.status === 'EXPIRED',
        };
      })
    );

  ngOnInit(): void {
    this.ageEligibility.adultAccessAllowed$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((allowed) => {
        if (allowed) {
          this.continueAfterAgeConfirmation();
        }
      });
  }

  confirmAdult(): void {
    if (this.processing()) {
      return;
    }

    this.processing.set(true);
    this.feedback.set({
      tone: 'info',
      title: 'Registrando sua declaração',
      message: 'Isso leva apenas alguns segundos.',
    });

    this.ageEligibility.submitSelfAttestation$()
      .pipe(
        take(1),
        catchError(() => {
          this.feedback.set({
            tone: 'error',
            title: 'Não foi possível confirmar agora',
            message:
              'Sua declaração não foi registrada. Tente novamente em alguns instantes.',
          });
          return EMPTY;
        }),
        finalize(() => this.processing.set(false))
      )
      .subscribe((result) => {
        this.feedback.set({
          tone: 'success',
          title:
            result.assuranceLevel === 'VERIFIED'
              ? 'Maioridade já verificada'
              : 'Declaração registrada',
          message:
            result.assuranceLevel === 'VERIFIED'
              ? 'Sua conta já possui uma verificação forte válida.'
              : 'Você confirmou que tem 18 anos ou mais. Vamos continuar.',
        });

        this.continueAfterAgeConfirmation();
      });
  }

  goToNotifications(): void {
    void this.router.navigate(['/notificacoes']);
  }

  goToAccount(): void {
    void this.router.navigate(['/conta']);
  }

  logoutCurrentSession(): void {
    if (this.processing()) {
      return;
    }

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

  private continueAfterAgeConfirmation(): void {
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
