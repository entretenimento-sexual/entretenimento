// src\app\authentication\authentication.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms'; // Para usar ngModel e outros recursos de formulários

// Importe o RouterModule se este módulo tiver rotas
import { RouterModule } from '@angular/router';
import { LoginComponent } from './login-component/login-component';
import { ProgressiveSignupComponent } from './progressive-signup/progressive-signup.component';
import { AuthenticationRoutingModule } from './authentication-routing.module';
import { SuggestedProfilesComponent } from './suggested-profiles/suggested-profiles.component';
import { MatCardModule } from '@angular/material/card';
import { SuggestionService } from '../core/services/data-handling/suggestion.service';
import { AuthService } from '../core/services/autentication/auth.service';
import { EmailInputModalComponent } from './email-input-modal/email-input-modal.component';


@NgModule({
  declarations: [
    LoginComponent,
    ProgressiveSignupComponent,
    SuggestedProfilesComponent,
  ],

  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    RouterModule,
    AuthenticationRoutingModule, // Se este módulo tiver rotas
    MatCardModule,
    EmailInputModalComponent,

  ],

  exports: [
    LoginComponent,
    ProgressiveSignupComponent,
    SuggestedProfilesComponent
  ],

})
export class AuthenticationModule { }
