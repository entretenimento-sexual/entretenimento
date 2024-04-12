// src\app\app-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { RegisterComponent } from './authentication/register-component/register.component';
import { LoginComponent } from './authentication/login-component/login-component';
import { EspiarComponent } from './authentication/espiar/espiar.component';
import { ProfileListComponent } from './layout/profile-list/profile-list.component';
import { AuthGuard } from './core/guards/auth.guard';
import { SubscriptionPlanComponent } from './subscriptions/subscription-plan/subscription-plan.component';

// import { SeuComponente404 } from './seu-componente-404/seu-componente-404.component'; // Exemplo de componente 404

const routes: Routes = [

  {
    path: '',
    redirectTo: '/dashboard/principal',
    pathMatch: 'full'
  },

  { path: 'dashboard', loadChildren: () => import('./dashboard/dashboard.module').then(m => m.DashboardModule) },

  {
    path: 'perfil',
    loadChildren: () => import('./user-profile/user-profile.module').then(m => m.UserProfileModule),
    canActivate: [AuthGuard]
  },

  { path: 'layout',
  loadChildren: () => import('./layout/layout.module').then(m => m.LayoutModule) },

  { path: 'chat',
  loadChildren: () => import('./chat-module/chat-module').then(m => m.ChatModuleModule) },

  {
    path: 'photos',
    loadChildren: () => import('./photo/photo.module').then(m => m.PhotoModule),
    canActivate: [AuthGuard] // Se necessário
  },

  { path: 'profile-list', component: ProfileListComponent }, // rota para a lista de perfis
  { path: 'register-component', component: RegisterComponent }, // rota para o componente de registro
  { path: 'login', component: LoginComponent }, // rota para o componente de login
  { path: 'espiar', component: EspiarComponent }, // rota para o componente Espiar
  { path: 'subscription-plan', component: SubscriptionPlanComponent },
  // { path: '**', component: SeuComponente404 } // rota coringa para capturar URLs não definidas e mostrar uma página 404
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
