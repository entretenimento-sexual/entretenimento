// src/app/app-routing.module.ts
import { NgModule } from '@angular/core';
import { NoPreloading, RouterModule, Routes } from '@angular/router';

import { authGuard } from './core/guards/auth-guard/auth.guard';
import { guestOnlyCanActivate, guestOnlyCanMatch } from './core/guards/auth-guard/guest-only.guard';
import { adminCanMatch } from './core/guards/access-guard/admin.guard';
import { emailVerifiedGuard } from './core/guards/profile-guard/email-verified.guard';
import { profileCompletedGuard } from './core/guards/profile-guard/profile-completed.guard';

import { SubscriptionPlanComponent } from './subscriptions/subscription-plan/subscription-plan.component';
import { LayoutShellComponent } from './layout/layout-shell/layout-shell.component';
import { accountLifecycleGuard } from './account/guards/account-lifecycle.guard';

const routes: Routes = [
  {
    path: '',
    component: LayoutShellComponent,
    children: [
      {
        path: '',
        redirectTo: 'login',
        pathMatch: 'full',
      },

      {
        path: 'principal',
        redirectTo: 'dashboard/principal',
        pathMatch: 'full',
      },
      {
        path: 'amigos',
        redirectTo: 'friends',
        pathMatch: 'full',
      },
      {
        path: 'meu-perfil',
        redirectTo: 'perfil',
        pathMatch: 'full',
      },
      {
        path: 'meu-perfil/:uid',
        redirectTo: 'perfil/:uid',
        pathMatch: 'full',
      },
      {
        path: 'profile/:id',
        redirectTo: 'perfil/:id',
        pathMatch: 'full',
      },
      {
        path: 'finalizar-cadastro',
        redirectTo: 'register/finalizar-cadastro',
        pathMatch: 'full',
      },
      {
        path: 'welcome',
        redirectTo: 'register/welcome',
        pathMatch: 'full',
      },

      {
        path: 'perfil/:uid/fotos',
        redirectTo: 'media/perfil/:uid/fotos',
        pathMatch: 'full',
      },
      {
        path: 'perfil/:uid/fotos/upload',
        redirectTo: 'media/perfil/:uid/fotos/upload',
        pathMatch: 'full',
      },
      {
        path: 'profile-list',
        redirectTo: 'dashboard/online',
        pathMatch: 'full',
      },
      {
        path: 'perfis-proximos',
        redirectTo: 'dashboard/online',
        pathMatch: 'full',
      },
      {
        path: 'register',
        loadChildren: () => import('./register-module/register.module').then(m => m.RegisterModule),
        canMatch: [guestOnlyCanMatch],
        canActivate: [guestOnlyCanActivate],
        data: {
          allowUnverified: true,
          guestAllowAuthenticatedPaths: ['welcome', 'verify', 'finalizar-cadastro'],
        },
      },

      {
        path: 'login',
        loadChildren: () => import('./authentication/authentication.module').then(m => m.AuthenticationModule),
        canMatch: [guestOnlyCanMatch],
        canActivate: [guestOnlyCanActivate],
        data: {
          allowUnverified: true,
          guestAllowAuthenticatedPaths: ['progressive-signup', 'suggested-profiles'],
        },
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

      {
        path: 'dashboard',
        loadChildren: () => import('./dashboard/dashboard.module').then(m => m.DashboardModule),
        canActivate: [authGuard, accountLifecycleGuard],
      },

      {
        path: 'perfil',
        loadChildren: () => import('./user-profile/user-profile.module').then(m => m.UserProfileModule),
        canActivate: [authGuard, accountLifecycleGuard],
      },

      {
        path: 'chat',
        loadChildren: () => import('./chat-module/chat-module').then(m => m.ChatModule),
        canActivate: [authGuard, accountLifecycleGuard, emailVerifiedGuard, profileCompletedGuard],
        data: {
          requireVerified: true,
          requireProfileCompleted: true,
        },
      },

      {
        path: 'preferencias',
        loadChildren: () =>
          import('./preferences/preferences.routes').then(m => m.PREFERENCES_ROUTES),
        canActivate: [authGuard, accountLifecycleGuard, emailVerifiedGuard],
        data: {
          requireVerified: true,
        },
      },

      {
        path: 'friends',
        loadChildren: () =>
          import('./layout/friend-management/friend-management.module')
            .then(m => m.FriendManagementModule),
        canActivate: [authGuard, accountLifecycleGuard, emailVerifiedGuard, profileCompletedGuard],
        data: {
          requireVerified: true,
          requireProfileCompleted: true,
        },
      },

      {
        path: 'admin-dashboard',
        loadChildren: () => import('./admin-dashboard/admin-dashboard.module').then(m => m.AdminDashboardModule),
        canMatch: [adminCanMatch],
        canActivate: [authGuard, accountLifecycleGuard, emailVerifiedGuard, profileCompletedGuard],
        data: {
          requireVerified: true,
          requireProfileCompleted: true,
        },
      },

      /**
       * Aqui eu deixei leve de propósito:
       * assinatura/checkout não deveriam depender de e-mail verificado
       * se você quiser exigir depois, pode voltar o emailVerifiedGuard.
       */
      {
        path: 'subscription-plan',
        component: SubscriptionPlanComponent,
        canActivate: [authGuard, accountLifecycleGuard],
        data: {
          requireVerified: false,
        },
      },
      {
        path: 'checkout',
        loadComponent: () =>
          import('./subscriptions/checkout/checkout.component').then(
            (m) => m.CheckoutComponent
          ),
        canActivate: [authGuard, accountLifecycleGuard],
        data: {
          requireVerified: false,
        },
      },

      {
        path: 'billing',
        loadChildren: () =>
          import('./payments-core/payments-core.routes').then(
            (m) => m.PAYMENTS_CORE_ROUTES
          ),
      },
      {
        path: 'perfil-debug/:id',
        loadComponent: () =>
          import('./perfil-debug.component').then(c => c.PerfilDebugComponent),
        canActivate: [authGuard],
      },

      {
        path: 'conta',
        loadChildren: () =>
          import('./account/account.routes').then((m) => m.ACCOUNT_ROUTES),
      },

      {
        path: 'media',
        loadChildren: () =>
          import('./media/media.routes').then(m => m.MEDIA_ROUTES),
        canActivate: [authGuard, accountLifecycleGuard],
      },
    ],
  },
  {
    path: '**',
    redirectTo: 'login',
  },
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, {
      preloadingStrategy: NoPreloading,
      bindToComponentInputs: true,
      initialNavigation: 'enabledNonBlocking',
      enableTracing: false,
    }),
  ],
  exports: [RouterModule],
})
export class AppRoutingModule {}