// src/app/account/account.routes.ts
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
    path: 'documentos-legais',
    canActivate: [authOnlyGuard],
    loadComponent: () =>
      import('./pages/legal-documents/legal-documents.component').then(
        (m) => m.LegalDocumentsComponent
      ),
  },
  {
    path: 'conformidade',
    canActivate: [authOnlyGuard],
    loadComponent: () =>
      import('./pages/compliance-cases/compliance-cases.component').then(
        (m) => m.ComplianceCasesComponent
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
