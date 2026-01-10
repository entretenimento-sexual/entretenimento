// src/app/app-routing.module.ts
import { NgModule } from '@angular/core';
import { NoPreloading, RouterModule, Routes } from '@angular/router';

import { authGuard } from './core/guards/auth.guard';
import { authRedirectGuard } from './core/guards/auth-redirect.guard';
import { emailVerifiedGuard } from './core/guards/email-verified.guard';

import { ProfileListComponent } from './layout/profile-list/profile-list.component';
import { SubscriptionPlanComponent } from './subscriptions/subscription-plan/subscription-plan.component';
import { adminCanMatch } from './core/guards/admin.guard';
import { environment } from 'src/environments/environment';

const routes: Routes = [
  { path: '',
    redirectTo: 'login',
    pathMatch: 'full'
  },
  {
    path: 'dashboard',
    loadChildren: () => import('./dashboard/dashboard.module').then(m => m.DashboardModule),

  },
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
    canActivate: [authGuard, emailVerifiedGuard],
  },
  {
    path: 'friends',
    loadChildren: () =>
      import('./layout/friend.management/friend.management.module')
        .then(m => m.FriendManagementModule),
    canActivate: [authGuard, emailVerifiedGuard],
  },
  {
    path: 'admin-dashboard',
    loadChildren: () => import('./admin-dashboard/admin-dashboard.module').then(m => m.AdminDashboardModule),
    canMatch: [adminCanMatch],     // ⬅️ aqui
    canActivate: [emailVerifiedGuard],
  },
  {
    path: 'register',
    loadChildren: () => import('./register-module/register.module').then(m => m.RegisterModule),
    //canActivate: [authRedirectGuard],
    data: { allowUnverified: true },
  },
  {
    path: 'login',
    loadChildren: () =>
      import('./authentication/authentication.module')
        .then(m => m.AuthenticationModule),
    //canActivate: [authRedirectGuard],
    data: { allowUnverified: true },
  },
  {
    path: 'post-verification/action',
    loadComponent: () =>
      import('./register-module/auth-verification-handler/auth-verification-handler.component')
        .then(m => m.AuthVerificationHandlerComponent),
    data: { allowUnverified: true },
  },
  {
    path: '__/auth/action',
    loadComponent: () =>
      import('./register-module/auth-verification-handler/auth-verification-handler.component')
        .then(m => m.AuthVerificationHandlerComponent),
    data: { allowUnverified: true },
  },
  { path: 'profile-list', component: ProfileListComponent },
  { path: 'subscription-plan',
    component: SubscriptionPlanComponent
  },
  { path: '**',
    redirectTo: 'login'
  },

];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, {
      preloadingStrategy: NoPreloading,
      bindToComponentInputs: true,
      initialNavigation: 'enabledNonBlocking',
      //enableTracing: !environment.production //enableTracing:
      //registra os eventos de navegação interna no console. Uso para depuração.
      //enableTracing: true,
    }),
  ],
  exports: [RouterModule],
})
export class AppRoutingModule { }
