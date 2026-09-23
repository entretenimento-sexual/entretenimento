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
  AGE_ACCESS_ALLOWS_SELF_DECLARATION,
} from 'src/app/core/services/compliance/age-access-policy.generated';
import {
  AgeEligibilityService,
} from 'src/app/core/services/compliance/age-eligibility.service';

interface AgeVerificationPageVm {
  state: IUserAgeEligibility;
  deniedUnderage: boolean;
  strongReviewRequired: boolean;
  canSelfDeclare: boolean;
  legacyInitialReview: boolean;
}

type FeedbackTone = 'info' | 'success' | 'error';

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
        const legacyInitialReview =
          state.status === 'REVIEW_REQUIRED' &&
          state.source === 'INITIAL_VERIFICATION' &&
          state.method === 'MANUAL_REVIEW' &&
          String(state.caseId ?? '').startsWith('age_initial_');

        const deniedUnderage = state.status === 'DENIED_UNDERAGE';
        const strongReviewRequired =
          state.status === 'REVIEW_REQUIRED' && !legacyInitialReview;

        return {
          state,
          deniedUnderage,
          strongReviewRequired,
          legacyInitialReview,
          canSelfDeclare:
            AGE_ACCESS_ALLOWS_SELF_DECLARATION &&
            !deniedUnderage &&
            !strongReviewRequired,
        };
      })
    );

  ngOnInit(): void {
    this.ageEligibility.adultAccessAllowed$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((allowed) => {
        if (allowed) {
          this.continueAfterAgeStep();
        }
      });
  }

  declareAdult(): void {
    if (this.processing()) {
      return;
    }

    this.processing.set(true);
    this.feedback.set({
      tone: 'info',
      title: 'Registrando sua confirmação',
      message: 'Isso leva apenas alguns instantes.',
    });

    this.ageEligibility.declareAdultAccess$()
      .pipe(
        take(1),
        catchError(() => {
          this.feedback.set({
            tone: 'error',
            title: 'Não foi possível registrar sua confirmação',
            message:
              'Tente novamente. Se houver uma restrição de segurança na conta, ela continuará visível aqui.',
          });
          return EMPTY;
        }),
        finalize(() => this.processing.set(false))
      )
      .subscribe(() => {
        this.feedback.set({
          tone: 'success',
          title: 'Confirmação registrada',
          message:
            'Você confirmou ter 18 anos ou mais. Estamos preparando a próxima etapa.',
        });
        // A navegação ocorre pelo adultAccessAllowed$ assim que a projeção
        // backend chega pelo listener realtime. Isso evita corrida com guards.
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
