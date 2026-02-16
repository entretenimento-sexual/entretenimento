// src/app/app-routing.module.ts
import { NgModule } from '@angular/core';
import { NoPreloading, RouterModule, Routes } from '@angular/router';

import { authGuard } from './core/guards/auth-guard/auth.guard';
import { emailVerifiedGuard } from './core/guards/profile-guard/email-verified.guard';
import { guestOnlyCanActivate, guestOnlyCanMatch } from './core/guards/auth-guard/guest-only.guard';
import { adminCanMatch } from './core/guards/access-guard/admin.guard';

import { ProfileListComponent } from './layout/profile-list/profile-list.component';
import { SubscriptionPlanComponent } from './subscriptions/subscription-plan/subscription-plan.component';

const routes: Routes = [
  { path: '',
    redirectTo: 'login',
    pathMatch: 'full' },

  // ---------------------------------------------------------------------------
  // ✅ ALIASES (consertam “Principal” e “Meu perfil” mesmo se link estiver errado)
  // ---------------------------------------------------------------------------
  { path: 'principal',
    redirectTo: 'dashboard/principal',
    pathMatch: 'full'
  },
  {
    path: 'dashboard',
    loadChildren: () => import('./dashboard/dashboard.module').then(m => m.DashboardModule),
    //canActivate: [authGuard], // authGuard já cuida de profileCompleted + enforceVerified
  },

  // ✅ ALIASES (compatibilidade)
  { path: 'meu-perfil', redirectTo: 'perfil', pathMatch: 'full' },
  { path: 'meu-perfil/:uid', redirectTo: 'perfil/:uid', pathMatch: 'full' },

  // ✅ legacy internacionalizado (não use mais em links novos)
  { path: 'profile/:id', redirectTo: 'perfil/:id', pathMatch: 'full' },

  // ✅ CANÔNICO
  {
    path: 'perfil',
    loadChildren: () => import('./user-profile/user-profile.module').then(m => m.UserProfileModule),
  },

  {
    path: 'chat',
    loadChildren: () => import('./chat-module/chat-module').then(m => m.ChatModule),
    //canActivate: [authGuard, emailVerifiedGuard],
  },

  {
    path: 'friends',
    loadChildren: () =>
      import('./layout/friend-management/friend-management.module')
        .then(m => m.FriendManagementModule),
    //canActivate: [authGuard, emailVerifiedGuard],
  },

  {
    path: 'admin-dashboard',
    loadChildren: () => import('./admin-dashboard/admin-dashboard.module').then(m => m.AdminDashboardModule),
    //canMatch: [adminCanMatch],
    //canActivate: [authGuard, emailVerifiedGuard],
  },

  {
    path: 'register',
    loadChildren: () => import('./register-module/register.module').then(m => m.RegisterModule),
    //canMatch: [guestOnlyCanMatch],
    //canActivate: [guestOnlyCanActivate],
    data: { allowUnverified: true, guestAllowAuthenticatedPaths: ['welcome', 'verify', 'finalizar-cadastro'] },
  },

  {
    path: 'login',
    loadChildren: () => import('./authentication/authentication.module').then(m => m.AuthenticationModule),
    //canMatch: [guestOnlyCanMatch],
    //canActivate: [guestOnlyCanActivate],
    data: { allowUnverified: true,
      guestAllowAuthenticatedPaths: ['progressive-signup', 'suggested-profiles'] },
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

  // ✅ Se forem páginas internas, proteja:
  { path: 'profile-list',
    component: ProfileListComponent,
    //canActivate: [authGuard, emailVerifiedGuard]
    },
  { path: 'subscription-plan',
    component: SubscriptionPlanComponent,
    //canActivate: [authGuard]
  },
  { path: 'finalizar-cadastro', redirectTo: 'register/finalizar-cadastro', pathMatch: 'full' },
  { path: 'welcome', redirectTo: 'register/welcome', pathMatch: 'full' },

  {
   path: 'perfil-debug/:id',
   loadComponent: () =>
     import('./perfil-debug.component').then(c => c.PerfilDebugComponent),
  },

  {
    path: '',
    loadChildren: () =>
      import('./media/media.routes').then(m => m.MEDIA_ROUTES),
  },

  { path: '**',
    redirectTo: 'dashboard/principal' },
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, {
      preloadingStrategy: NoPreloading,
      bindToComponentInputs: true,
      initialNavigation: 'enabledNonBlocking',
      //enableTracing: !environment.production //enableTracing:
      //registra os eventos de navegação interna no console. Uso para depuração.
      enableTracing: false,
    }),
  ],
  exports: [RouterModule],
})
export class AppRoutingModule { }
/*
Estados do usuário e acesso às rotas em relação a perfil e verificação de e-mail.
GUEST: não autenticado
AUTHED + PROFILE_INCOMPLETE: logado, mas ainda não completou cadastro mínimo
AUTHED + PROFILE_COMPLETE + UNVERIFIED: logado, cadastro ok, mas e-mail não verificado
AUTHED + PROFILE_COMPLETE + VERIFIED: liberado total
*/
/*
Rotas públicas: /login, /register/**, /faq, /termos
Rotas authed mas “restritas”: /dashboard/principal, /perfil/:id (próprio)
Rotas que exigem VERIFIED: /chat/**, /friends/**, /dashboard/online, /dashboard/featured-profiles
Rotas que exigem PROFILE_COMPLETE: discovery, listagens amplas e qualquer ação social que exponha/consuma dados de terceiros
*/
