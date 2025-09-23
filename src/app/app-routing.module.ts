// src/app/app-routing.module.ts
import { NgModule } from '@angular/core';
import { NoPreloading, RouterModule, Routes } from '@angular/router';

import { authGuard } from './core/guards/auth.guard';
import { authRedirectGuard } from './core/guards/auth-redirect.guard';
import { authOnlyGuard } from './core/guards/auth-only.guard';
import { emailVerifiedGuard } from './core/guards/email-verified.guard';

import { ProfileListComponent } from './layout/profile-list/profile-list.component';
import { SubscriptionPlanComponent } from './subscriptions/subscription-plan/subscription-plan.component';
import { LoginComponent } from './authentication/login-component/login-component';

const routes: Routes = [
  { path: '', redirectTo: '/dashboard/principal', pathMatch: 'full' },

  // 🔒 Área logada (só entra se autenticado) + exige e-mail verificado
  {
    path: 'dashboard',
    loadChildren: () => import('./dashboard/dashboard.module').then(m => m.DashboardModule),
    canMatch: [authOnlyGuard],
    canActivate: [emailVerifiedGuard],
  },

  // 🔒 Outras rotas privadas
  {
    path: 'profile/:id',
    loadComponent: () =>
      import('./layout/other-user-profile-view/other-user-profile-view.component')
        .then(c => c.OtherUserProfileViewComponent),
    canActivate: [authGuard, emailVerifiedGuard],
  },
  {
    path: 'perfil',
    loadChildren: () => import('./user-profile/user-profile.module').then(m => m.UserProfileModule),
    canActivate: [authGuard, emailVerifiedGuard],
  },
  {
    path: 'chat',
    loadChildren: () => import('./chat-module/chat-module').then(m => m.ChatModule),
    canLoad: [authGuard],
    canActivate: [authGuard, emailVerifiedGuard],
  },
  {
    path: 'admin-dashboard',
    loadChildren: () => import('./admin-dashboard/admin-dashboard.module').then(m => m.AdminDashboardModule),
    canActivate: [authGuard, emailVerifiedGuard],
  },

  // ✉️ Fluxos de registro/login (bloqueiam se já estiver logado)
  {
    path: 'register',
    loadChildren: () => import('./register-module/register.module').then(m => m.RegisterModule),
    canActivate: [authRedirectGuard],
    data: { allowUnverified: true }, 
  },
  {
    path: 'login',
    component: LoginComponent,
    canActivate: [authRedirectGuard],
  },

  // ✅ Handler do e-mail de verificação
  {
    path: 'post-verification/action',
    loadComponent: () =>
      import('./register-module/auth-verification-handler/auth-verification-handler.component')
        .then(m => m.AuthVerificationHandlerComponent),
    data: { allowUnverified: true },
  },
  // (opcional) caminho “padrão” do Firebase
  {
    path: '__/auth/action',
    loadComponent: () =>
      import('./register-module/auth-verification-handler/auth-verification-handler.component')
        .then(m => m.AuthVerificationHandlerComponent),
    data: { allowUnverified: true },
  },

  // 🌐 Públicas
  { path: 'profile-list', component: ProfileListComponent },
  { path: 'subscription-plan', component: SubscriptionPlanComponent },

  // ↪️ Fallback
  { path: '**', redirectTo: '/dashboard/principal' },
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, {
      preloadingStrategy: NoPreloading,
      bindToComponentInputs: true,
      initialNavigation: 'enabledBlocking',
    }),
  ],
  exports: [RouterModule],
})
export class AppRoutingModule { }
