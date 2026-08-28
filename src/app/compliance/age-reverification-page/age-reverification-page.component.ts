import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { EMPTY, Observable } from 'rxjs';
import { catchError, finalize, map, take } from 'rxjs/operators';

import {
  IUserAgeReverification,
} from 'src/app/core/interfaces/iuser-dados';
import { LogoutService } from 'src/app/core/services/autentication/auth/logout.service';
import {
  AgeReverificationService,
} from 'src/app/core/services/compliance/age-reverification.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { normalizeAgeReverificationStatus } from 'src/app/core/guards/compliance/age-reverification-status.util';

interface AgeReverificationPageVm {
  state: IUserAgeReverification | null;
  status: IUserAgeReverification['status'] | 'NONE';
  label: string;
  canSubmit: boolean;
  isPendingReview: boolean;
}

@Component({
  selector: 'app-age-reverification-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './age-reverification-page.component.html',
  styleUrls: ['./age-reverification-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgeReverificationPageComponent {
  private readonly ageReverification = inject(AgeReverificationService);
  private readonly notification = inject(ErrorNotificationService);
  private readonly logoutService = inject(LogoutService);
  private readonly router = inject(Router);

  readonly isSaving = signal(false);
  readonly form = new FormGroup({
    birthDate: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    confirmsTruthfulness: new FormControl(false, {
      nonNullable: true,
      validators: [Validators.requiredTrue],
    }),
    acceptsRestrictedProcessing: new FormControl(false, {
      nonNullable: true,
      validators: [Validators.requiredTrue],
    }),
  });

  readonly vm$: Observable<AgeReverificationPageVm> =
    this.ageReverification.currentState$.pipe(
      map((state) => {
        const status = normalizeAgeReverificationStatus(state?.status);

        return {
          state,
          status,
          label: this.ageReverification.statusLabel(state),
          canSubmit: status === 'REQUIRED',
          isPendingReview: status === 'SUBMITTED' || status === 'UNDER_REVIEW',
        };
      })
    );

  submit(): void {
    if (this.form.invalid || this.isSaving()) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSaving.set(true);

    this.ageReverification.submitCurrent$(this.form.getRawValue())
      .pipe(
        take(1),
        catchError(() => {
          this.notification.showError(
            'Não foi possível enviar a revalidação. Revise os dados e tente novamente.'
          );
          return EMPTY;
        }),
        finalize(() => this.isSaving.set(false))
      )
      .subscribe(() => {
        this.form.disable({ emitEvent: false });
        this.notification.showSuccess(
          'Revalidação enviada. A conta permanecerá limitada até a análise.'
        );
      });
  }

  goToAccount(): void {
    this.router.navigate(['/conta']).catch(() => undefined);
  }

  logout(): void {
    if (this.isSaving()) {
      return;
    }

    this.logoutService.logout$()
      .pipe(
        take(1),
        catchError(() => {
          this.notification.showError('Não foi possível encerrar sua sessão.');
          return EMPTY;
        })
      )
      .subscribe();
  }
}
