import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminDashboardComponent } from './admin-dashboard.component';
import { UserListComponent } from './user-list/user-list.component';
import { UserDetailsComponent } from './user-details/user-details.component';
import { ModerationReportsComponent } from './moderation-reports/moderation-reports.component';
import { OperationalOverviewComponent } from './operational-overview/operational-overview.component';
import { VideoModerationComponent } from './video-moderation/video-moderation.component';
import { AccountDeletionOperationsComponent } from './account-deletion-operations/account-deletion-operations.component';
import { adminCanActivateChild } from '../core/guards/access-guard/admin.guard';
import { UserResolver } from './resolvers/user.resolver';

const routes: Routes = [
  {
    path: '',
    component: AdminDashboardComponent,
    canActivateChild: [adminCanActivateChild],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'operacional' },
      { path: 'operacional', component: OperationalOverviewComponent },
      { path: 'exclusoes', component: AccountDeletionOperationsComponent },
      { path: 'users', component: UserListComponent },
      {
        path: 'users/:uid',
        component: UserDetailsComponent,
        resolve: { user: UserResolver },
      },
      { path: 'denuncias', component: ModerationReportsComponent },
      { path: 'videos', component: VideoModerationComponent },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AdminDashboardRoutingModule { }
