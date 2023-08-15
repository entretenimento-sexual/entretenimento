// src\app\authentication\authentication.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms'; // Para usar ngModel e outros recursos de formulários

// Importe o serviço de autenticação
import { AuthService } from '../core/services/autentication/auth.service'; // Caminho ajustado para o seu serviço de autenticação

// Importe o RouterModule se este módulo tiver rotas
import { RouterModule } from '@angular/router';
import { LoginComponent } from './login-component/login-component';
import { RegisterComponent } from './register-component/register.component';
import { EspiarComponent } from './espiar/espiar.component';


@NgModule({
  declarations: [
    LoginComponent,
    RegisterComponent,
    EspiarComponent
  ],

  imports: [
    CommonModule,
    FormsModule, // Se você estiver usando formulários
    RouterModule // Se este módulo tiver rotas
  ],

  exports: [
    LoginComponent,
    RegisterComponent,
    EspiarComponent
  ],

  providers: [
    AuthService // Se você tiver um serviço de autenticação
  ]
})
export class AuthenticationModule { }
