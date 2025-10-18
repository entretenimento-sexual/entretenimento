// src\app\layout\friend.management\friend.management-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'list' },
  { path: 'list', loadComponent: () => import('./friend-list-page/friend-list-page.component').then(m => m.FriendListPageComponent) },
  { path: 'requests', loadComponent: () => import('./friend-requests/friend-requests.component').then(m => m.FriendRequestsComponent) },
  { path: 'search', loadComponent: () => import('./friend-search/friend-search.component').then(m => m.FriendSearchComponent) },
  { path: 'blocked', loadComponent: () => import('./friend-blocked/friend-blocked.component').then(m => m.FriendBlockedComponent) },
  { path: 'settings', loadComponent: () => import('./friend-settings/friend-settings.component').then(m => m.FriendSettingsComponent) },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class FriendManagementRoutingModule { }
