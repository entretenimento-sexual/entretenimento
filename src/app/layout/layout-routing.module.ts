// src/app/layout/layout-routing.module.ts
// Rotas de layout relacionadas a descoberta e visualização de terceiros.
//
// Regra:
// - essas telas consomem / expõem dados de terceiros
// - portanto exigem:
//   - autenticação
//   - e-mail verificado
//   - perfil completo
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { PerfisProximosComponent } from './perfis-proximos/perfis-proximos.component';
import { authGuard } from '../core/guards/auth-guard/auth.guard';

const routes: Routes = [
  {
    path: 'perfis-proximos',
    component: PerfisProximosComponent,
    canActivate: [authGuard],
    data: {
      requireVerified: true,
      requireProfileCompleted: true,
    }
  },
  {
    path: 'outro-perfil/:id',
    loadComponent: () => import('./other-user-profile-view/other-user-profile-view.component')
      .then(c => c.OtherUserProfileViewComponent),
    canActivate: [authGuard],
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
export class LayoutRoutingModule { }
