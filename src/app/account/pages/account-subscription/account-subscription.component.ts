// src/app/account/pages/account-subscription/account-subscription.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import {
  Subject,
  of,
} from 'rxjs';
import {
  catchError,
  exhaustMap,
  filter,
  finalize,
  shareReplay,
  startWith,
  switchMap,
  tap,
} from 'rxjs/operators';

import { AccountFacade } from '../../application/account.facade';
import { BillingRepository } from 'src/app/payments-core/infrastructure/repositories/billing.repository';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import {
  ConfirmationDialogComponent,
} from 'src/app/shared/components-globais/confirmation-dialog/confirmation-dialog.component';

@Component({
  selector: 'app-account-subscription',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './account-subscription.component.html',
  styleUrl: '../account-section.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountSubscriptionComponent {
  private readonly facade = inject(AccountFacade);
  private readonly billingRepository = inject(BillingRepository);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly refreshRenewal$ = new Subject<void>();
  private readonly cancelRequest$ = new Subject<void>();

  readonly vm$ = this.facade.vm$;
  readonly cancelingRenewal = signal(false);

  readonly renewalState$ = this.refreshRenewal$.pipe(
    startWith(void 0),
    switchMap(() =>
      this.billingRepository.getMyBillingSnapshot$().pipe(
        catchError((error: unknown) => {
          this.applicationError.report(error, {
            feature: 'account-subscription',
            operation: 'loadRenewalState',
            fallbackMessage:
              'Não foi possível carregar o estado da renovação automática.',
            presentation: { surface: 'none', severity: 'error' },
            metadata: { scope: 'AccountSubscriptionComponent' },
          });
          return of(null);
        })
      )
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor() {
    this.cancelRequest$
      .pipe(
        exhaustMap(() =>
          this.dialog
            .open(ConfirmationDialogComponent, {
              data: {
                title: 'Cancelar renovação automática',
                eyebrow: 'Assinatura',
                message:
                  'Novas cobranças serão interrompidas. O período que já foi pago continuará disponível até o vencimento atual.',
                detail:
                  'Depois do vencimento, a conta volta ao plano gratuito se nenhuma nova assinatura for contratada.',
                confirmLabel: 'Cancelar renovação',
                cancelLabel: 'Manter renovação',
                tone: 'warning',
                icon: 'event_busy',
              },
              autoFocus: false,
              restoreFocus: true,
            })
            .afterClosed()
        ),
        filter((confirmed): confirmed is true => confirmed === true),
        tap(() => this.cancelingRenewal.set(true)),
        exhaustMap(() =>
          this.billingRepository
            .cancelPlatformSubscriptionRenewal$()
            .pipe(
              tap(() => this.refreshRenewal$.next()),
              catchError((error: unknown) => {
                this.applicationError.report(error, {
                  feature: 'account-subscription',
                  operation: 'cancelRenewal',
                  fallbackMessage:
                    'Não foi possível concluir o cancelamento da renovação agora.',
                  presentation: {
                    surface: 'modal',
                    severity: 'error',
                  },
                  metadata: {
                    scope: 'AccountSubscriptionComponent',
                  },
                });
                return of(null);
              }),
              finalize(() => this.cancelingRenewal.set(false))
            )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  cancelRenewal(): void {
    if (this.cancelingRenewal()) return;
    this.cancelRequest$.next();
  }
}
