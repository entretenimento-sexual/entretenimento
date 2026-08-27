// src/app/account/account.routes.ts
import { Routes } from '@angular/router';
import { authOnlyGuard } from '@core/guards/auth-guard/auth-only.guard';
import { accountLifecycleGuard } from './guards/account-lifecycle.guard';
import { accountStatusPageGuard } from './guards/account-status-page.guard';

export const ACCOUNT_ROUTES: Routes = [
  // Históricos permanecem páginas dedicadas para preservar foco e leitura.
  {
    path: 'assinatura/historico',
    canActivate: [authOnlyGuard],
    loadComponent: () =>
      import('./pages/subscription-history/subscription-history.component').then(
        (m) => m.SubscriptionHistoryComponent
      ),
  },
  {
    path: 'seguranca/historico-privilegios',
    canActivate: [authOnlyGuard],
    loadComponent: () =>
      import('./pages/account-privilege-history/account-privilege-history.component').then(
        (m) => m.AccountPrivilegeHistoryComponent
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
  {
    path: '',
    canActivate: [authOnlyGuard],
    loadComponent: () =>
      import('./pages/account-shell/account-shell.component').then(
        (m) => m.AccountShellComponent
      ),
    children: [
      {
        path: '',
        pathMatch: 'full',
        canActivate: [accountLifecycleGuard],
        loadComponent: () =>
          import('./pages/account-home/account-home.component').then(
            (m) => m.AccountHomeComponent
          ),
      },
      {
        path: 'seguranca',
        canActivate: [accountLifecycleGuard],
        loadComponent: () =>
          import('./pages/account-security/account-security.component').then(
            (m) => m.AccountSecurityComponent
          ),
      },
      {
        path: 'assinatura',
        canActivate: [accountLifecycleGuard],
        loadComponent: () =>
          import('./pages/account-subscription/account-subscription.component').then(
            (m) => m.AccountSubscriptionComponent
          ),
      },
      {
        path: 'gerenciar',
        canActivate: [accountLifecycleGuard],
        loadComponent: () =>
          import('./pages/account-manage/account-manage.component').then(
            (m) => m.AccountManageComponent
          ),
      },
    ],
  },
];
