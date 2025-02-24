//src\app\admin-dashboard\admin-dashboard.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { AdminDashboardRoutingModule } from './admin-dashboard-routing.module';
import { AdminDashboardComponent } from './admin-dashboard.component';
import { UserListComponent } from './user-list/user-list.component';
import { UserDetailsComponent } from './user-details/user-details.component';


@NgModule({
  declarations: [
    AdminDashboardComponent,
    UserListComponent,
    UserDetailsComponent
  ],
  imports: [
    CommonModule,
    AdminDashboardRoutingModule
  ]
})
export class AdminDashboardModule { }
