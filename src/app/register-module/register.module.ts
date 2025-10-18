// src/app/register-module/register.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { RegisterRoutingModule } from './register-routing.module';
import { RegisterComponent } from './register.component';
import { FinalizarCadastroComponent } from './finalizar-cadastro/finalizar-cadastro.component';
import { WelcomeComponent } from './welcome/welcome.component';
import { RegisterErrorMessagePipe } from '../shared/pipes/register-error-message.pipe';
import { EmailInputModalComponent } from '../authentication/email-input-modal/email-input-modal.component';

@NgModule({
  declarations: [
    RegisterComponent,
    FinalizarCadastroComponent,
    WelcomeComponent,

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
