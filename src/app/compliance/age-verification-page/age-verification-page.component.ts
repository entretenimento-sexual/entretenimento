import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { EMPTY, Observable } from 'rxjs';
import {
  catchError,
  filter,
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
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

interface AgeVerificationPageVm {
  state: IUserAgeEligibility;
  verified: boolean;
  deniedUnderage: boolean;
  reviewRequired: boolean;
  expired: boolean;
}

@Component({
  selector: 'app-age-verification-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './age-verification-page.component.html',
  styleUrls: ['./age-verification-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgeVerificationPageComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly ageEligibility = inject(AgeEligibilityService);
  private readonly notification = inject(ErrorNotificationService);
  private readonly logout = inject(LogoutService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly refreshing = signal(false);
  readonly requestingReview = signal(false);

  readonly vm$: Observable<AgeVerificationPageVm> =
    this.ageEligibility.current$.pipe(
      map((state) => ({
        state,
        verified: state.status === 'VERIFIED_ADULT',
        deniedUnderage: state.status === 'DENIED_UNDERAGE',
        reviewRequired: state.status === 'REVIEW_REQUIRED',
        expired: state.status === 'EXPIRED',
      }))
    );

  constructor() {
    // Quando a projeção backend se torna válida, o usuário avança sem reload.
    this.ageEligibility.verifiedAdult$
      .pipe(
        filter((verified) => verified),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.resumeOriginalDestination());
  }

  continueAfterVerification(): void {
    this.resumeOriginalDestination();
  }

  requestReview(): void {
    if (this.refreshing() || this.requestingReview()) {
      return;
    }

    this.requestingReview.set(true);

    this.ageEligibility.requestInitialReview$()
      .pipe(
        take(1),
        catchError(() => {
          this.notification.showError(
            'Não foi possível solicitar a verificação agora. Tente novamente em instantes.'
          );
          return EMPTY;
        }),
        finalize(() => this.requestingReview.set(false))
      )
      .subscribe((result) => {
        if (result.status === 'VERIFIED_ADULT') {
          this.notification.showSuccess('Sua maioridade já está confirmada.');
          this.resumeOriginalDestination();
          return;
        }

        this.notification.showInfo(
          'Solicitação recebida. Esta tela será atualizada quando houver uma decisão.'
        );
      });
  }

  refresh(): void {
    if (this.refreshing() || this.requestingReview()) {
      return;
    }

    this.refreshing.set(true);

    this.ageEligibility.refreshTrustedSources$()
      .pipe(
        take(1),
        catchError(() => {
          this.notification.showError(
            'Não foi possível verificar uma atualização agora. Tente novamente em instantes.'
          );
          return EMPTY;
        }),
        finalize(() => this.refreshing.set(false))
      )
      .subscribe((status) => {
        if (status === 'VERIFIED_ADULT') {
          this.notification.showSuccess('Maioridade confirmada.');
          this.resumeOriginalDestination();
          return;
        }

        if (status === 'DENIED_UNDERAGE') {
          this.notification.showWarning(
            'O acesso adulto não está disponível com a decisão atual.'
          );
          return;
        }

        if (status === 'REVIEW_REQUIRED') {
          this.notification.showInfo(
            'Sua verificação continua em análise.'
          );
          return;
        }

        this.notification.showInfo(
          'Ainda não há uma verificação de maioridade válida para esta conta.'
        );
      });
  }

  logoutCurrentSession(): void {
    if (this.refreshing() || this.requestingReview()) {
      return;
    }

    this.logout.logout$()
      .pipe(
        take(1),
        catchError(() => {
          this.notification.showError(
            'Não foi possível encerrar sua sessão.'
          );
          return EMPTY;
        })
      )
      .subscribe();
  }

  private resumeOriginalDestination(): void {
    const target = this.resolveSafeRedirectTo() ?? '/dashboard/principal';

    void this.router.navigateByUrl(target, {
      replaceUrl: true,
    });
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
      value.startsWith('/adulto/verificar-idade') ||
      value.startsWith('/adulto/confirmar')
    ) {
      return null;
    }

    return value;
  }
}
