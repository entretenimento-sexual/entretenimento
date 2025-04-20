// src\app\register-module\register.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RegisterRoutingModule } from './register-routing.module';
import { FormsModule, ReactiveFormsModule } from '@angular/forms'; // ✅ Adicionando FormsModule
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule } from '@angular/material/dialog';
import { RouterModule } from '@angular/router'; // ✅ Adicionando RouterModule
import { WelcomeComponent } from './welcome/welcome.component';
import { AuthVerificationHandlerComponent } from './auth-verification-handler/auth-verification-handler.component';
import { FinalizarCadastroComponent } from './finalizar-cadastro/finalizar-cadastro.component';
import { RegisterComponent } from './register.component';
import { EmailInputModalComponent } from '../authentication/email-input-modal/email-input-modal.component';
import { RegisterUiComponent } from './register-ui/register-ui.component';

@NgModule({
  declarations: [
    RegisterComponent,
    WelcomeComponent,
    AuthVerificationHandlerComponent,
    FinalizarCadastroComponent,

  ],
  imports: [
    CommonModule,
    RouterModule, // ✅ Necessário para `routerLink`
    RegisterRoutingModule,
    FormsModule, // ✅ Necessário para `ngModel`
    ReactiveFormsModule,
    MatInputModule,
    MatButtonModule,
    MatDialogModule,
    MatCheckboxModule,
    EmailInputModalComponent,
    RegisterUiComponent
  ],

  exports: [
    RegisterComponent,
    EmailInputModalComponent
  ],
})
export class RegisterModule { }
