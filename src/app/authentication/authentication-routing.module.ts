//src\app\authentication\authentication-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router'; // Adicionado 'RouterModule'
import { ProgressiveSignupComponent } from './progressive-signup/progressive-signup.component';
import { SuggestedProfilesComponent } from './suggested-profiles/suggested-profiles.component';
import { RegisterComponent } from './register-component/register.component';
import { ResetPasswordComponent } from './reset-password/reset-password.component';
import { AuthVerificationHandlerComponent } from './auth-verification-handler/auth-verification-handler.component';


// Definindo as rotas para o módulo de autenticação.
const authRoutes: Routes = [
  { path: 'progressive-signup', component: ProgressiveSignupComponent },
  { path: 'suggested-profiles', component: SuggestedProfilesComponent },
  { path: 'register', component: RegisterComponent },
  {
    path: 'post-verification/action',
    component: AuthVerificationHandlerComponent
  },

  // Adicione um redirecionamento para a página inicial ou uma página 404, caso não haja correspondência
  { path: '**', redirectTo: '/' }
];

@NgModule({
  declarations: [],
  imports: [
    RouterModule.forChild(authRoutes) // Importando as rotas filhas para este módulo.
  ],
  exports: [RouterModule] // Exportando RouterModule para que as rotas fiquem disponíveis no módulo principal.
})
export class AuthenticationRoutingModule { }
