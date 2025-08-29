//src\app\dashboard\dashboard-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { OnlineUsersComponent } from './online-users/online-users.component';
import { FeaturedProfilesComponent } from './featured-profiles/featured-profiles.component';
import { PrincipalComponent } from './principal/principal.component';
import { ChatRoomsComponent } from '../chat-module/chat-rooms/chat-rooms.component';
import { DashboardLayoutComponent } from './dashboard-layout/dashboard-layout.component';
import { authOnlyGuard } from '../core/guards/auth-only.guard';
import { emailVerifiedGuard } from '../core/guards/email-verified.guard';

const routes: Routes = [
  {
    path: '',
    component: DashboardLayoutComponent,
    canActivate: [authOnlyGuard], // << era authGuard
    children: [
      { path: 'principal', component: PrincipalComponent }, // permite sem verificar
      { path: 'online-users', component: OnlineUsersComponent }, // opcional exigir
      { path: 'featured-profiles', component: FeaturedProfilesComponent, canActivate: [emailVerifiedGuard] }, // exige verificação
      { path: 'chat-rooms', component: ChatRoomsComponent, canActivate: [emailVerifiedGuard] }, // exige verificação
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
