//src\app\account\account.routes.ts
import { Routes } from '@angular/router';

export const ACCOUNT_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/account-home/account-home.component').then(
        (m) => m.AccountHomeComponent
      ),
  },
];