// src/app/register-module/register-routing.module.ts
// Não esqueça os comentáros explicativos.
// Rotas do módulo de registro (lazy em /register).
// Mantém o fluxo do cadastro isolado e previsível:
// - /register -> form de registro
// - /register/welcome -> onboarding/verificação
// - /register/verify -> handler interno opcional (se você quiser manter)

import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { RegisterComponent } from './register.component';
import { WelcomeComponent } from './welcome/welcome.component';
import { AuthVerificationHandlerComponent } from './auth-verification-handler/auth-verification-handler.component';
import { FinalizarCadastroComponent } from './finalizar-cadastro/finalizar-cadastro.component';

const routes: Routes = [
  // /register (cadastro “puro”) -> NÃO permitimos autenticado (guard vai bloquear)
  { path: '',
    component: RegisterComponent,
    data: { allowUnverified: true } },
  // /register/welcome -> PERMITIMOS autenticado (onboarding/verificação)
  { path: 'welcome',
    component: WelcomeComponent,
    data: { allowUnverified: true, allowAuthenticated: true } },

  // Opcional: se você usa /register/verify em algum fluxo interno.
  // Se não usa, pode remover e deixar apenas o handler global do AppRouting.
  { path: 'verify',
    component: AuthVerificationHandlerComponent,
    data: { allowUnverified: true, allowAuthenticated: true } },
  {
    path: 'finalizar-cadastro',
    component: FinalizarCadastroComponent,
    data: { allowUnverified: true, allowAuthenticated: true },
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class RegisterRoutingModule { }
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
