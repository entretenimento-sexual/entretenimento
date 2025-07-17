// src/app/app-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { authGuard } from './core/guards/auth.guard';
import { authRedirectGuard } from './core/guards/auth-redirect.guard';
import { ProfileListComponent } from './layout/profile-list/profile-list.component';
import { SubscriptionPlanComponent } from './subscriptions/subscription-plan/subscription-plan.component';
import { LoginComponent } from './authentication/login-component/login-component';

const routes: Routes = [
  { path: '', redirectTo: '/dashboard/principal', pathMatch: 'full' },

  // Rotas privadas protegidas por authGuard
  {
    path: 'dashboard',
    loadChildren: () => import('./dashboard/dashboard.module').then(m => m.DashboardModule),
    canActivate: [authGuard],
  },
  {
    path: 'profile/:id',
    loadComponent: () =>
      import('./layout/other-user-profile-view/other-user-profile-view.component').then(c => c.OtherUserProfileViewComponent),
    canActivate: [authGuard],
  },
  {
    path: 'perfil',
    loadChildren: () => import('./user-profile/user-profile.module').then(m => m.UserProfileModule),
    canActivate: [authGuard],
  },
  {
    path: 'chat',
    loadChildren: () => import('./chat-module/chat-module').then(m => m.ChatModule),
    canActivate: [authGuard],
  },
  {
    path: 'admin-dashboard',
    loadChildren: () => import('./admin-dashboard/admin-dashboard.module').then(m => m.AdminDashboardModule),
    canActivate: [authGuard],
  },

  // Rotas públicas com authRedirectGuard para evitar acesso de usuários já logados
  {
    path: 'register',
    loadChildren: () => import('./register-module/register.module').then(m => m.RegisterModule),
    canActivate: [authRedirectGuard],
  },
  {
    path: 'login',
    component: LoginComponent,
    canActivate: [authRedirectGuard],
  },

  // Rotas acessíveis para todos
  { path: 'profile-list', component: ProfileListComponent },
  { path: 'subscription-plan', component: SubscriptionPlanComponent },

  // Redirecionamento para dashboard por padrão
  { path: '**', redirectTo: '/dashboard/principal' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { bindToComponentInputs: true })],
  exports: [RouterModule],
})
export class AppRoutingModule { }
