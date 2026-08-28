// src/app/layout/layout-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { PerfisProximosComponent } from './perfis-proximos/perfis-proximos.component';
import { authGuard } from '../core/guards/auth-guard/auth.guard';
import { emailVerifiedGuard } from '../core/guards/profile-guard/email-verified.guard';
import { profileCompletedGuard } from '../core/guards/profile-guard/profile-completed.guard';

const routes: Routes = [
  {
    path: 'perfis-proximos',
    component: PerfisProximosComponent,
    canActivate: [authGuard, profileCompletedGuard],
    data: {
      requireVerified: false,
      requireProfileCompleted: true,
    }
  },
  {
    path: 'outro-perfil/:id',
    loadComponent: () => import('./other-user-profile-view/other-user-profile-view.component')
      .then(c => c.OtherUserProfileViewComponent),
    canActivate: [authGuard, emailVerifiedGuard, profileCompletedGuard],
    data: {
      requireVerified: true,
      requireProfileCompleted: true,
    }
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class LayoutRoutingModule {}