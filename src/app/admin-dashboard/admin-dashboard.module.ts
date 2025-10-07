//src\app\admin-dashboard\admin-dashboard.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';

import { AdminDashboardRoutingModule } from './admin-dashboard-routing.module';
import { AdminDashboardComponent } from './admin-dashboard.component';
import { UserListComponent } from './user-list/user-list.component';
import { UserDetailsComponent } from './user-details/user-details.component';
import { AdminMaterialModule } from './admin-material.module';

@NgModule({
  declarations: [
    AdminDashboardComponent,

  ],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    AdminMaterialModule,
    AdminDashboardRoutingModule,
    UserListComponent,
    UserDetailsComponent,

  ],
})
export class AdminDashboardModule { }
