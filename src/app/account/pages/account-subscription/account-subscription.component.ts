// src/app/account/pages/account-subscription/account-subscription.component.ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { AccountFacade } from '../../application/account.facade';

@Component({
  selector: 'app-account-subscription',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './account-subscription.component.html',
  styleUrl: '../account-section.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountSubscriptionComponent {
  readonly vm$ = inject(AccountFacade).vm$;
}
