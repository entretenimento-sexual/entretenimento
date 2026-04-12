//src\app\payments-core\pages\billing-return\billing-return.component.ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

import { BillingReturnFacade } from '../../application/billing-return.facade';

@Component({
  selector: 'app-billing-return',
  standalone: true,
  imports: [CommonModule],
  providers: [BillingReturnFacade],
  templateUrl: './billing-return.component.html',
  styleUrls: ['./billing-return.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BillingReturnComponent {
  readonly facade = inject(BillingReturnFacade);
  readonly vm$ = this.facade.vm$;

  onPrimaryAction(): void {
    this.facade.retry().catch(() => {
      // noop
    });
  }
}