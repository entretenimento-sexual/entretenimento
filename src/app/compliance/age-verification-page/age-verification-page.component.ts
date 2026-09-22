import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterModule } from '@angular/router';
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
  private readonly ageEligibility = inject(AgeEligibilityService);
  private readonly notification = inject(ErrorNotificationService);
  private readonly logout = inject(LogoutService);
  private readonly router = inject(Router);

  readonly refreshing = signal(false);

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

  refresh(): void {
    if (this.refreshing()) {
      return;
    }

    this.refreshing.set(true);

    this.ageEligibility.refreshTrustedSources$()
      .pipe(
        take(1),
        catchError(() => {
          this.notification.showError(
            'Não foi possível atualizar o status da verificação de maioridade.'
          );
          return EMPTY;
        }),
        finalize(() => this.refreshing.set(false))
      )
      .subscribe((status) => {
        if (status === 'VERIFIED_ADULT') {
          this.notification.showSuccess(
            'Maioridade confirmada por uma fonte confiável.'
          );
          void this.router.navigateByUrl('/adulto/confirmar', {
            replaceUrl: true,
          });
          return;
        }

        if (status === 'DENIED_UNDERAGE') {
          this.notification.showWarning(
            'O acesso adulto não está disponível para esta conta.'
          );
          return;
        }

        this.notification.showWarning(
          'Ainda não há uma verificação de maioridade válida para esta conta.'
        );
      });
  }

  logoutCurrentSession(): void {
    if (this.refreshing()) {
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
}
