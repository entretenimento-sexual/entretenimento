// src\app\app-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { ProfileListComponent } from './layout/profile-list/profile-list.component';
import { AuthGuard } from './core/guards/auth.guard';
import { SubscriptionPlanComponent } from './subscriptions/subscription-plan/subscription-plan.component';
import { authRedirectGuard } from './core/guards/auth-redirect.guard';
import { LoginComponent } from './authentication/login-component/login-component';
import { RegisterComponent } from './register-module/register.component';

const routes: Routes = [
  {
    path: '',
    redirectTo: '/dashboard/principal',
    pathMatch: 'full',
  },
  {
    path: 'dashboard',
    loadChildren: () => import('./dashboard/dashboard.module').then((m) => m.DashboardModule),
    canActivate: [AuthGuard], // Proteção do Dashboard
  },
  {
    path: 'profile/:id',
    loadComponent: () =>
      import('./layout/other-user-profile-view/other-user-profile-view.component').then(
        (c) => c.OtherUserProfileViewComponent
      ),
    canActivate: [AuthGuard], // Proteção de perfis individuais
  },
  {
    path: 'perfil',
    loadChildren: () => import('./user-profile/user-profile.module').then((m) => m.UserProfileModule),
    canActivate: [AuthGuard], // Proteção de rotas do perfil do usuário
  },
  {
    path: 'layout',
    loadChildren: () => import('./layout/layout.module').then((m) => m.LayoutModule),
  },
  {
    path: 'chat',
    loadChildren: () => import('./chat-module/chat-module').then((m) => m.ChatModule),
    canActivate: [AuthGuard], // Proteção de chat (se for restrito a usuários logados)
  },
  { path: 'profile-list',
    component: ProfileListComponent },

  {
    path: 'register',
    loadChildren: () => import('./register-module/register.module').then((m) => m.RegisterModule),
    canActivate: [authRedirectGuard],
  },
  {
    path: 'login',
    component: LoginComponent,
    canActivate: [authRedirectGuard], // Redireciona usuários logados
  },
   { path: 'subscription-plan', component: SubscriptionPlanComponent },
  { path: 'admin-dashboard', loadChildren: () => import('./admin-dashboard/admin-dashboard.module').then(m => m.AdminDashboardModule) },

  // Redirecionamento padrão para rotas desconhecidas
  { path: '**', redirectTo: '/dashboard/principal' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule { }
