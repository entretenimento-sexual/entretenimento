// src\app\app-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { RegisterComponent } from './authentication/register-component/register.component';
import { LoginComponent } from './authentication/login-component/login-component';
import { EspiarComponent } from './authentication/espiar/espiar.component';
import { ProfileListComponent } from './layout/profile-list/profile-list.component';
//import { SeuComponente404 } from './seu-componente-404/seu-componente-404.component'; // Exemplo de componente 404

const routes: Routes = [
  { path: '', redirectTo: '/login', pathMatch: 'full' }, // redireciona a rota vazia para a página de login
  {
    path: 'perfil',
    loadChildren: () => import('./user-profile/user-profile.module').then(m => m.UserProfileModule)
  },
  { path: 'profile-list', component: ProfileListComponent },
  { path: 'register-component', component: RegisterComponent },
  { path: 'login', component: LoginComponent },
  { path: 'espiar', component: EspiarComponent },
  // { path: '**', component: SeuComponente404 }   rota coringa
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
