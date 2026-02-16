// src/app/dashboard/dashboard-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { FeaturedProfilesComponent } from './featured-profiles/featured-profiles.component';
import { PrincipalComponent } from './principal/principal.component';
import { ChatRoomsComponent } from '../chat-module/chat-rooms/chat-rooms.component';
import { DashboardLayoutComponent } from './dashboard-layout/dashboard-layout.component';
import { emailVerifiedGuard } from '../core/guards/profile-guard/email-verified.guard';
import { OnlineUsersComponent } from './online/online-users/online-users.component';
import { OnlineUsersFullComponent } from './online/online-users-full/online-users-full.component';
import { profileCompletedGuard } from '../core/guards/profile-guard/profile-completed.guard';

const routes: Routes = [
  {
    path: '',
    component: DashboardLayoutComponent,
    canActivate: [], // (se quiser proteger, coloque o guard aqui)
    children: [
      { path: 'principal',
        component: PrincipalComponent,
        canActivate: [profileCompletedGuard],
        data: { allowProfileIncomplete: true }
      },

      // mini/painel (se quiser manter)
      { path: 'online-users',
        component: OnlineUsersComponent
      },

      // ✅ página “cheia” para ver todos (recomendado usar um slug curto)
      { path: 'online', component: OnlineUsersFullComponent, canActivate: [emailVerifiedGuard] },

      { path: 'featured-profiles', component: FeaturedProfilesComponent, canActivate: [emailVerifiedGuard] },
      { path: 'chat-rooms', component: ChatRoomsComponent, canActivate: [emailVerifiedGuard] },
      {
        path: 'friends/list',
        canActivate: [emailVerifiedGuard],
        loadComponent: () =>
          import('src/app/layout/friend-management/friend-list-page/friend-list-page.component')
            .then(m => m.FriendListPageComponent)
      },
      { path: 'friends', redirectTo: 'friends/list', pathMatch: 'full' },

      { path: '', redirectTo: 'principal', pathMatch: 'full' },
    ]
  },
  { path: '**', redirectTo: 'principal' }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class DashboardRoutingModule { }
