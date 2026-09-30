// src/app/account/pages/account-security/account-security.component.ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { AccountFacade } from '../../application/account.facade';

import { ContentStateComponent } from '../../../shared/content-state/content-state.component';

@Component({
  selector: 'app-account-security',
  standalone: true,
  imports: [CommonModule, RouterModule, ContentStateComponent],
  templateUrl: './account-security.component.html',
  styleUrl: '../account-section.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountSecurityComponent {
  readonly vm$ = inject(AccountFacade).vm$;
}
