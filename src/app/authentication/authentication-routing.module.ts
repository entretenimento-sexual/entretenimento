//src\app\authentication\authentication-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router'; // Adicionado 'RouterModule'
import { ProgressiveSignupComponent } from './progressive-signup/progressive-signup.component';
import { SuggestedProfilesComponent } from './suggested-profiles/suggested-profiles.component';
import { AuthVerificationHandlerComponent } from './register-module/auth-verification-handler/auth-verification-handler.component';
import { FinalizarCadastroComponent } from './register-module/finalizar-cadastro/finalizar-cadastro.component';


// Definindo as rotas para o módulo de autenticação.
const authRoutes: Routes = [
  { path: 'progressive-signup', component: ProgressiveSignupComponent },
  { path: 'suggested-profiles', component: SuggestedProfilesComponent },
  { path: 'post-verification/action', component: AuthVerificationHandlerComponent},
  { path: 'verify-email', component: FinalizarCadastroComponent },
  { path: 'register', loadChildren: () => import('./register-module/register.module').then(m => m.RegisterModule) },
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
