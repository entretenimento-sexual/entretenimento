// src/app/account/account.routes.ts
// Comentários nunca atrapalham
import { Routes } from '@angular/router';
import { authOnlyGuard } from '@core/guards/auth-guard/auth-only.guard';
import { accountLifecycleGuard } from './guards/account-lifecycle.guard';
import { accountStatusPageGuard } from './guards/account-status-page.guard';

export const ACCOUNT_ROUTES: Routes = [
  {
    path: '',
    canActivate: [authOnlyGuard, accountLifecycleGuard],
    loadComponent: () =>
      import('./pages/account-home/account-home.component').then(
        (m) => m.AccountHomeComponent
      ),
  },
  {
    path: 'status',
    canActivate: [authOnlyGuard, accountStatusPageGuard],
    loadComponent: () =>
      import('./pages/account-status/account-status.component').then(
        (m) => m.AccountStatusComponent
      ),
  },
];