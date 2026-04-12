// src/app/payments-core/payments-core.routes.ts
import { Routes } from '@angular/router';

export const PAYMENTS_CORE_ROUTES: Routes = [
  {
    path: 'return',
    loadComponent: () =>
      import('./pages/billing-return/billing-return.component').then(
        (m) => m.BillingReturnComponent
      ),
  },
];