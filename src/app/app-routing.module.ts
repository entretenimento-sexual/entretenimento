// src/app/app-routing.module.ts
// Não esquecer comentários explicativos e ferramentas de debug
import { NgModule } from '@angular/core';
import { NoPreloading, RouterModule, Routes } from '@angular/router';

import { authGuard } from './core/guards/auth-guard/auth.guard';
import { guestOnlyCanActivate, guestOnlyCanMatch } from './core/guards/auth-guard/guest-only.guard';
import { adminCanMatch } from './core/guards/access-guard/admin.guard';

import { ProfileListComponent } from './layout/profile-list/profile-list.component';
import { SubscriptionPlanComponent } from './subscriptions/subscription-plan/subscription-plan.component';
import { LayoutShellComponent } from './layout/layout-shell/layout-shell.component';

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

      // ===============================================================
      // Aliases de compatibilidade
      // ===============================================================
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

      // ===============================================================
      // Fluxo guest / auth pages
      // ===============================================================
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

      // ===============================================================
      // Handlers globais de ação/verificação de auth
      // ===============================================================
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

      // ===============================================================
      // Áreas autenticadas
      // ===============================================================
      {
        path: 'dashboard',
        loadChildren: () => import('./dashboard/dashboard.module').then(m => m.DashboardModule),
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
        data: {
          requireVerified: true,
          requireProfileCompleted: true,
        },
      },

      {
        path: 'friends',
        loadChildren: () =>
          import('./layout/friend-management/friend-management.module')
            .then(m => m.FriendManagementModule),
        canActivate: [authGuard],
        data: {
          requireVerified: true,
          requireProfileCompleted: true,
        },
      },

      {
        path: 'admin-dashboard',
        loadChildren: () => import('./admin-dashboard/admin-dashboard.module').then(m => m.AdminDashboardModule),
        canMatch: [adminCanMatch],
        canActivate: [authGuard],
        data: {
          requireVerified: true,
          requireProfileCompleted: true,
        },
      },

      {
        path: 'profile-list',
        component: ProfileListComponent,
        canActivate: [authGuard],
        data: {
          requireVerified: true,
          requireProfileCompleted: true,
        },
      },

      {
        path: 'subscription-plan',
        component: SubscriptionPlanComponent,
      },

      {
        path: 'perfil-debug/:id',
        loadComponent: () =>
          import('./perfil-debug.component').then(c => c.PerfilDebugComponent),
        canActivate: [authGuard],
      },

      {
        path: 'media',
        loadChildren: () =>
          import('./media/media.routes').then(m => m.MEDIA_ROUTES),
        canActivate: [authGuard],
        data: {
          requireVerified: true,
          requireProfileCompleted: true,
        },
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
