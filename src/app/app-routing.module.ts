// src\app\app-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { RegisterComponent } from './authentication/register-component/register.component';
import { LoginComponent } from './authentication/login-component/login-component';
import { EspiarComponent } from './authentication/espiar/espiar.component';
import { ProfileListComponent } from './layout/profile-list/profile-list.component';
import { AuthGuard } from './core/guards/auth.guard';
import { SubscriptionPlanComponent } from './subscriptions/subscription-plan/subscription-plan.component';

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
  { path: 'layout', loadChildren: () => import('./layout/layout.module').then(m => m.LayoutModule) },
  { path: 'chat', loadChildren: () => import('./chat-module/chat-module').then(m => m.ChatModuleModule) },
  { path: 'profile-list', component: ProfileListComponent },
  { path: 'register-component', component: RegisterComponent },
  { path: 'login', component: LoginComponent },
  { path: 'espiar', component: EspiarComponent },
  { path: 'subscription-plan', component: SubscriptionPlanComponent },
  // { path: '**', component: SeuComponente404 }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]  // Adicione esta linha para exportar RouterModule
})
export class AppRoutingModule { }
