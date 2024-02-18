// src\app\app-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { RegisterComponent } from './authentication/register-component/register.component';
import { LoginComponent } from './authentication/login-component/login-component';
import { EspiarComponent } from './authentication/espiar/espiar.component';
import { ProfileListComponent } from './layout/profile-list/profile-list.component';
import { AuthGuard } from './core/guards/auth.guard';

// import { SeuComponente404 } from './seu-componente-404/seu-componente-404.component'; // Exemplo de componente 404

const routes: Routes = [

  {
    path: '',
    redirectTo: '/dashboard/principal',
    pathMatch: 'full'
  },
  { path: 'dashboard', loadChildren: () => import('./dashboard/dashboard.module').then(m => m.DashboardModule) },
  
  {
    path: '',
    redirectTo: '/progressive-signup',
    pathMatch: 'full' // redireciona a rota vazia para a página de progressive-signup (Note que essa rota precisa estar definida no módulo de autenticação.)
  },
  // Carrega o módulo de perfil quando a URL tem 'perfil' (sem ID) ou 'perfil/:id'.
  // Neste caso, estamos removendo a rota duplicada e utilizando somente a que possui :id.
  {
    path: 'perfil',
    loadChildren: () => import('./user-profile/user-profile.module').then(m => m.UserProfileModule),
    canActivate: [AuthGuard]
  },

  { path: 'layout', loadChildren: () => import('./layout/layout.module').then(m => m.LayoutModule) },

  { path: 'chat', loadChildren: () => import('./chat-module/chat-module').then(m => m.ChatModuleModule) },

  { path: 'profile-list', component: ProfileListComponent }, // rota para a lista de perfis
  { path: 'register-component', component: RegisterComponent }, // rota para o componente de registro
  { path: 'login', component: LoginComponent }, // rota para o componente de login
  { path: 'espiar', component: EspiarComponent }, // rota para o componente Espiar
  // { path: '**', component: SeuComponente404 } // rota coringa para capturar URLs não definidas e mostrar uma página 404
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
