// src/app/layout/layout-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { PerfisProximosComponent } from './perfis-proximos/perfis-proximos.component';
import { AuthGuard } from '../core/guards/auth.guard';


const routes: Routes = [
  { path: 'perfis-proximos', component: PerfisProximosComponent },
  {
    path: 'outro-perfil/:id',
    loadComponent: () => import('./other-user-profile-view/other-user-profile-view.component')
      .then(c => c.OtherUserProfileViewComponent),
    canActivate: [AuthGuard]
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class LayoutRoutingModule { }
