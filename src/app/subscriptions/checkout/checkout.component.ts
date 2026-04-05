//src\app\subscriptions\checkout\checkout.component.ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { take } from 'rxjs/operators';

import { CheckoutFacade } from 'src/app/payments-core/application/checkout.facade';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './checkout.component.html',
  styleUrls: ['./checkout.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CheckoutComponent {
  private readonly errorNotifier = inject(ErrorNotificationService);

  readonly facade = inject(CheckoutFacade);
  readonly plan$ = this.facade.plan$;

  continue(): void {
    this.facade.startCheckout$().pipe(take(1)).subscribe((checkoutUrl) => {
      if (!checkoutUrl) {
        this.errorNotifier.showError(
          'Checkout ainda não disponível para este plano.'
        );
        return;
      }

      window.location.href = checkoutUrl;
    });
  }

  back(): void {
    this.facade.goBackToPlans().catch(() => {
      this.errorNotifier.showError('Falha ao voltar para os planos.');
    });
  }
}