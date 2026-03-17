// src/app/dashboard/dashboard-routing.module.ts
// Rotas internas do dashboard.
//
// Convenção adotada:
// - o módulo /dashboard exige autenticação no AppRouting
// - rotas internas mais sensíveis usam authGuard com data:
//   - requireVerified
//   - requireProfileCompleted
//
// Isso deixa o fluxo previsível e evita espalhar guards diferentes em cada tela.

import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { FeaturedProfilesComponent } from './featured-profiles/featured-profiles.component';
import { PrincipalComponent } from './principal/principal.component';
import { ChatRoomsComponent } from '../chat-module/chat-rooms/chat-rooms.component';
import { DashboardLayoutComponent } from './dashboard-layout/dashboard-layout.component';
import { OnlineUsersComponent } from './online/online-users/online-users.component';
import { OnlineUsersFullComponent } from './online/online-users-full/online-users-full.component';

import { authGuard } from '../core/guards/auth-guard/auth.guard';

const routes: Routes = [
  {
    path: '',
    component: DashboardLayoutComponent,
    children: [
      /**
       * Dashboard principal:
       * - exige apenas autenticação
       * - útil como hub inicial
       * - não força verified/profileComplete aqui
       */
      {
        path: 'principal',
        component: PrincipalComponent,
      },

      /**
       * Painel compacto de online:
       * - continua dentro do dashboard
       * - se quiser endurecer depois, basta ligar flags
       */
      {
        path: 'online-users',
        component: OnlineUsersComponent,
      },

      /**
       * Discovery / listagem ampla:
       * - exige e-mail verificado
       * - exige perfil completo
       */
      {
        path: 'online',
        component: OnlineUsersFullComponent,
        canActivate: [authGuard],
        data: {
          requireVerified: true,
          requireProfileCompleted: true,
        },
      },

      {
        path: 'featured-profiles',
        component: FeaturedProfilesComponent,
        canActivate: [authGuard],
        data: {
          requireVerified: true,
          requireProfileCompleted: true,
        },
      },

      {
        path: 'chat-rooms',
        component: ChatRoomsComponent,
        canActivate: [authGuard],
        data: {
          requireVerified: true,
          requireProfileCompleted: true,
        },
      },

      {
        path: 'friends/list',
        canActivate: [authGuard],
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
