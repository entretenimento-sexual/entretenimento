// src\app\app-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { UserDetailsComponent } from './user-profile/user-details/user-details.component';
import { UserProfileResolve } from './user-profile/services-profile/user-profile.resolve';
import { ExtaseGuard } from './guards/extase.guard';
import { CommunityComponent } from './community/community/community.component';
import { AuthenticationGuard } from './guards/authentication.guard';
import { TelaInicialComponent } from './home/tela-inicial/tela-inicial.component';
import { RegisterComponent } from './authentication/register-component/register.component';
import { LoginComponent } from './authentication/login-component/login-component';
import { EspiarComponent } from './authentication/espiar/espiar.component';


const routes: Routes = [
  { path: '', redirectTo: '/tela-inicial', pathMatch: 'full' },
  { path: 'tela-inicial', component: TelaInicialComponent },
  { path: 'register-component', component: RegisterComponent },
  { path: 'login', component: LoginComponent },
  { path: 'espiar', component: EspiarComponent },

  {
    path: 'user-profile/:userId',
    component: UserDetailsComponent,
    canActivate: [AuthenticationGuard],
    resolve: { userProfile: UserProfileResolve }
  },

  {
    path: 'community',
    canActivate: [ExtaseGuard], // Apenas usuários com perfil extase podem acessar
    component: CommunityComponent // Ajuste conforme necessário
  },
  // outras rotas do seu aplicativo...
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
