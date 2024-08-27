// src\app\authentication\authentication.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms'; // Para usar ngModel e outros recursos de formulários

// Importe o RouterModule se este módulo tiver rotas
import { RouterModule } from '@angular/router';
import { LoginComponent } from './login-component/login-component';
import { RegisterComponent } from './register-component/register.component';
import { EspiarComponent } from './espiar/espiar.component';
import { ProgressiveSignupComponent } from './progressive-signup/progressive-signup.component';
import { AuthenticationRoutingModule } from './authentication-routing.module';
import { FirestoreService } from '../core/services/autentication/firestore.service';
import { SuggestedProfilesComponent } from './suggested-profiles/suggested-profiles.component';
import { MatCardModule } from '@angular/material/card';
import { SuggestionService } from '../core/services/data-handling/suggestion.service';
import { AuthService } from '../core/services/autentication/auth.service';


@NgModule({
  declarations: [
    LoginComponent,
    RegisterComponent,
    EspiarComponent,
    ProgressiveSignupComponent,
    SuggestedProfilesComponent
  ],

  imports: [
    CommonModule,
    FormsModule, // Se você estiver usando formulários
    RouterModule, AuthenticationRoutingModule, // Se este módulo tiver rotas
    MatCardModule
  ],

  exports: [
    LoginComponent,
    RegisterComponent,
    EspiarComponent,
    ProgressiveSignupComponent,
    SuggestedProfilesComponent
  ],

  providers: [SuggestionService, AuthService]
})
export class AuthenticationModule { }
