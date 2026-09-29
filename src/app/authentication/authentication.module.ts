// src\app\authentication\authentication.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms'; // Para usar ngModel e outros recursos de formulários

// Importe o RouterModule se este módulo tiver rotas
import { RouterModule } from '@angular/router';
import { LoginComponent } from './login-component/login-component';
import { AuthenticationRoutingModule } from './authentication-routing.module';
import { MatCardModule } from '@angular/material/card';
import { EmailInputModalComponent } from './email-input-modal/email-input-modal.component';

@NgModule({
  declarations: [
    LoginComponent,
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
    
  ],

})
export class AuthenticationModule { }
