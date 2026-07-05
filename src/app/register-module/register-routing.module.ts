// src/app/register-module/register-routing.module.ts
// Rotas do módulo de registro.
//
// Regras:
// - /register -> tela pública de cadastro
// - /register/welcome -> etapa autenticada de verificação/onboarding
// - /register/verify -> handler interno autenticado
// - /register/finalizar-cadastro -> etapa autenticada de conclusão do perfil após e-mail verificado
//
// Observação importante:
// - o guard do pai (/register) continua sendo guestOnly
// - as etapas internas que dependem de sessão usam authGuard aqui,
//   para impedir acesso direto por visitante

import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { RegisterComponent } from './register.component';
import { WelcomeComponent } from './welcome/welcome.component';
import { AuthVerificationHandlerComponent } from './auth-verification-handler/auth-verification-handler.component';
import { FinalizarCadastroComponent } from './finalizar-cadastro/finalizar-cadastro.component';

import { authGuard } from '../core/guards/auth-guard/auth.guard';
import { emailVerifiedGuard } from '../core/guards/profile-guard/email-verified.guard';
import { registrationStepGuard } from './data-access/registration-step.guard';

const routes: Routes = [
  {
    path: '',
    component: RegisterComponent,
    data: {
      allowUnverified: true,
    },
  },
  {
    path: 'welcome',
    component: WelcomeComponent,
    canActivate: [authGuard, registrationStepGuard],
    data: {
      allowUnverified: true,
      allowAuthenticated: true,
      allowedRegisterSteps: ['emailVerification'],
    },
  },
  {
    path: 'verify',
    component: AuthVerificationHandlerComponent,
    data: {
      allowUnverified: true,
      allowAuthenticated: true,
    },
  },
  {
    path: 'finalizar-cadastro',
    component: FinalizarCadastroComponent,
    canActivate: [authGuard, emailVerifiedGuard, registrationStepGuard],
    data: {
      allowAuthenticated: true,
      allowedRegisterSteps: ['profileCompletion'],
    },
  },
  {
    path: '**',
    redirectTo: '',
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class RegisterRoutingModule { }
