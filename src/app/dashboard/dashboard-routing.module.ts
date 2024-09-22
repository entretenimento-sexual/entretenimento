//src\app\dashboard\dashboard-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { OnlineUsersComponent } from './online-users/online-users.component';
import { FeaturedProfilesComponent } from './featured-profiles/featured-profiles.component';
import { PrincipalComponent } from './principal/principal.component';
import { ChatRoomsComponent } from '../chat-module/chat-rooms/chat-rooms.component';
import { AuthGuard } from '../core/guards/auth.guard'; // Autenticação
import { DashboardLayoutComponent } from './dashboard-layout/dashboard-layout.component';

const routes: Routes = [
  {
    path: '',
    component: DashboardLayoutComponent, // Estrutura compartilhada
    canActivate: [AuthGuard], // Todas as rotas são protegidas por autenticação
    children: [
      { path: 'principal', component: PrincipalComponent, data: { title: 'Dashboard Principal' } },
      { path: 'online-users', component: OnlineUsersComponent, data: { title: 'Usuários Online' } },
      { path: 'featured-profiles', component: FeaturedProfilesComponent, data: { title: 'Perfis em Destaque' } },
      { path: 'chat-rooms', component: ChatRoomsComponent, data: { title: 'Salas de Chat' } },
      { path: '', redirectTo: 'principal', pathMatch: 'full' },
    ]
  },
  { path: '**', redirectTo: 'principal' } // Redirecionamento para rotas não encontradas
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class DashboardRoutingModule { }
