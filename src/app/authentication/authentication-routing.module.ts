// src/app/authentication/authentication-routing.module.ts
// Rotas do módulo de autenticação (lazy em /login).
// Boas práticas (padrão grandes plataformas):
// - /login -> somente login (e fluxos adjacentes como recuperação).
// - Registro fica em /register (fora daqui), evitando /login/register.
// - Handler de verificação fica no AppRouting (rota global), evitando /login/post-verification/action.

import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { LoginComponent } from './login-component/login-component';
import { ProgressiveSignupComponent } from './progressive-signup/progressive-signup.component';
import { SuggestedProfilesComponent } from './suggested-profiles/suggested-profiles.component';

const authRoutes: Routes = [
  // /login
  { path: '', component: LoginComponent },

  // /login/progressive-signup (se ainda fizer sentido no seu fluxo)
  { path: 'progressive-signup', component: ProgressiveSignupComponent },

  // /login/suggested-profiles
  { path: 'suggested-profiles', component: SuggestedProfilesComponent },
];

@NgModule({
  imports: [RouterModule.forChild(authRoutes)],
  exports: [RouterModule],
})
export class AuthenticationRoutingModule { }
