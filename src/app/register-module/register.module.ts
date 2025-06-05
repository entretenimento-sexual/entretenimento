// src/app/register-module/register.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms'; // ⬅️ ADICIONADO FormsModule
import { RegisterRoutingModule } from './register-routing.module';
import { RegisterComponent } from './register.component';
import { FinalizarCadastroComponent } from './finalizar-cadastro/finalizar-cadastro.component';
import { WelcomeComponent } from './welcome/welcome.component';
import { AuthVerificationHandlerComponent } from './auth-verification-handler/auth-verification-handler.component';
import { RegisterErrorMessagePipe } from './pipes/register-error-message.pipe';
import { EmailInputModalComponent } from '../authentication/email-input-modal/email-input-modal.component';

@NgModule({
  declarations: [
    RegisterComponent,
    FinalizarCadastroComponent,
    WelcomeComponent,
    AuthVerificationHandlerComponent,
  ],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RegisterRoutingModule,
    RegisterErrorMessagePipe,
    EmailInputModalComponent
  ]
})
export class RegisterModule { }
