// src/app/authentication/authentication-routing.module.ts
// Rotas do módulo de autenticação (lazy em /login).
//
// Boas práticas:
// - /login -> login e fluxos diretamente ligados à autenticação
// - /register fica fora daqui, em /register
// - handlers globais de verificação ficam no AppRouting
//
// Observação:
// - a permissão para autenticado nessas rotas específicas é resolvida
//   pelo guestOnly guard no AppRouting + data.allowAuthenticated aqui

import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { LoginComponent } from './login-component/login-component';
import { ProgressiveSignupComponent } from './progressive-signup/progressive-signup.component';

const authRoutes: Routes = [
  {
    path: '',
    component: LoginComponent,
  },

  {
    path: 'progressive-signup',
    component: ProgressiveSignupComponent,
    data: { allowAuthenticated: true },
  },

];

@NgModule({
  imports: [RouterModule.forChild(authRoutes)],
  exports: [RouterModule],
})
export class AuthenticationRoutingModule {}
