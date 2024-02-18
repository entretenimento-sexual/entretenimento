//src\app\dashboard\dashboard-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { OnlineUsersComponent } from './online-users/online-users.component';
import { FeaturedProfilesComponent } from './featured-profiles/featured-profiles.component';
import { PrincipalComponent } from './principal/principal.component';

const routes: Routes = [
  { path: 'principal', component: PrincipalComponent },
  { path: 'online-users', component: OnlineUsersComponent },
  { path: 'featured-profiles', component: FeaturedProfilesComponent },
  // ...outras rotas
];
@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class DashboardRoutingModule { }
