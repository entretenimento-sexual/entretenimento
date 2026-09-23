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
  verified: boolean;
  selfDeclared: boolean;
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
  readonly feedback = signal<PageFeedback | null>(null);

  readonly vm$: Observable<AgeVerificationPageVm> =
    this.ageEligibility.current$.pipe(
      map((state) => ({
        state,
        accessAllowed:
          state.status === 'SELF_DECLARED_ADULT' ||
          state.status === 'VERIFIED_ADULT',
        verified: state.status === 'VERIFIED_ADULT',
        selfDeclared: state.status === 'SELF_DECLARED_ADULT',
        deniedUnderage: state.status === 'DENIED_UNDERAGE',
        reviewRequired: state.status === 'REVIEW_REQUIRED',
      }))
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

  confirmAdult(): void {
    if (this.processing()) {
      return;
    }

    this.processing.set(true);
    this.feedback.set({
      tone: 'info',
      title: 'Registrando sua confirmação',
      message:
        'Estamos registrando sua declaração de que você tem 18 anos ou mais.',
    });

    this.ageEligibility.acceptSelfDeclaration$()
      .pipe(
        take(1),
        catchError(() => {
          this.feedback.set({
            tone: 'error',
            title: 'Não foi possível continuar',
            message:
              'Não conseguimos registrar sua confirmação agora. Tente novamente em alguns instantes.',
          });
          return EMPTY;
        }),
        finalize(() => this.processing.set(false))
      )
      .subscribe(() => {
        this.feedback.set({
          tone: 'success',
          title: 'Maioridade declarada',
          message:
            'Sua confirmação foi registrada. Estamos preparando a próxima etapa.',
        });
        this.continueAfterAgeStep();
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
