// src/app/dashboard/dashboard-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { FeaturedProfilesComponent } from './featured-profiles/featured-profiles.component';
import { PrincipalComponent } from './principal/principal.component';
import { ChatRoomsComponent } from '../chat-module/chat-rooms/chat-rooms.component';
import { DashboardLayoutComponent } from './dashboard-layout/dashboard-layout.component';
import { OnlineUsersComponent } from './online/online-users/online-users.component';
import { OnlineUsersFullComponent } from './online/online-users-full/online-users-full.component';

import { authGuard } from '../core/guards/auth-guard/auth.guard';
import { emailVerifiedGuard } from '../core/guards/profile-guard/email-verified.guard';
import { profileCompletedGuard } from '../core/guards/profile-guard/profile-completed.guard';

const routes: Routes = [
  {
    path: '',
    component: DashboardLayoutComponent,
    children: [
      {
        path: 'principal',
        component: PrincipalComponent,
      },

      /**
       * Painel compacto:
       * política leve
       * - exige autenticação
       * - não exige verificação de e-mail no guard
       * - UX local já trata perfil mínimo no clique da localização
       */
      {
        path: 'online-users',
        component: OnlineUsersComponent,
        canActivate: [authGuard],
      },

      /**
       * Discovery canônico da plataforma.
       * Toda navegação de "ver pessoas", "explorar perfis" e "online"
       * deve convergir para /dashboard/online.
       */
      {
        path: 'online',
        component: OnlineUsersFullComponent,
        canActivate: [authGuard, emailVerifiedGuard, profileCompletedGuard],
        data: {
          requireVerified: true,
          requireProfileCompleted: true,
        },
      },

      {
        path: 'featured-profiles',
        component: FeaturedProfilesComponent,
        canActivate: [authGuard, emailVerifiedGuard, profileCompletedGuard],
        data: {
          requireVerified: true,
          requireProfileCompleted: true,
        },
      },

      {
        path: 'chat-rooms',
        component: ChatRoomsComponent,
        canActivate: [authGuard, emailVerifiedGuard, profileCompletedGuard],
        data: {
          requireVerified: true,
          requireProfileCompleted: true,
        },
      },

      {
        path: 'friends/list',
        canActivate: [authGuard, emailVerifiedGuard, profileCompletedGuard],
        data: {
          requireVerified: true,
          requireProfileCompleted: true,
        },
        loadComponent: () =>
          import('src/app/layout/friend-management/friend-list-page/friend-list-page.component')
            .then(m => m.FriendListPageComponent)
      },

      {
        path: 'friends',
        redirectTo: 'friends/list',
        pathMatch: 'full',
      },

      {
        path: '',
        redirectTo: 'principal',
        pathMatch: 'full',
      },
    ]
  },

  {
    path: '**',
    redirectTo: 'principal',
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class DashboardRoutingModule { }