// src\app\layout\friend.management\friend.management-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { FriendListComponent } from './friend-list/friend-list.component';
import { FriendRequestsComponent } from './friend-requests/friend-requests.component';
import { FriendSearchComponent } from './friend-search/friend-search.component';
import { FriendBlockedComponent } from './friend-blocked/friend-blocked.component';
import { FriendSettingsComponent } from './friend-settings/friend-settings.component';

const routes: Routes = [
  { path: 'list', component: FriendListComponent },
  { path: 'requests', component: FriendRequestsComponent },
  { path: 'search', component: FriendSearchComponent },
  { path: 'blocked', component: FriendBlockedComponent },
  { path: 'settings', component: FriendSettingsComponent }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class FriendManagementRoutingModule { }
