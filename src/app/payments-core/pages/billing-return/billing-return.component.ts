//src\app\payments-core\pages\billing-return\billing-return.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { take } from 'rxjs/operators';

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
  private readonly destroyRef = inject(DestroyRef);
  readonly facade = inject(BillingReturnFacade);
  readonly vm$ = this.facade.vm$;

  onPrimaryAction(): void {
    this.facade
      .retry()
      .pipe(
        take(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }
}
