//src\app\dashboard\dashboard.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { DashboardRoutingModule } from './dashboard-routing.module';
import { OnlineUsersComponent } from './online-users/online-users.component';
import { FeaturedProfilesComponent } from './featured-profiles/featured-profiles.component';
import { PrincipalComponent } from './principal/principal.component';

@NgModule({
  declarations: [
    OnlineUsersComponent,
    FeaturedProfilesComponent,
    PrincipalComponent
  ],
  imports: [
    CommonModule,
    DashboardRoutingModule
  ]
})
export class DashboardModule { }
