//src\app\account\pages\account-home\account-home.component.ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { AccountFacade } from '../../application/account.facade';

@Component({
  selector: 'app-account-home',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './account-home.component.html',
  styleUrl: './account-home.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountHomeComponent {
  readonly accountFacade = inject(AccountFacade);
  readonly vm$ = this.accountFacade.vm$;
}