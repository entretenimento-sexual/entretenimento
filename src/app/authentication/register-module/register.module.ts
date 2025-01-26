//src\app\authentication\register-module\register.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RegisterRoutingModule } from './register-routing.module';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule } from '@angular/material/dialog';
import { RouterModule } from '@angular/router';
import { WelcomeComponent } from './welcome/welcome.component';
import { AuthVerificationHandlerComponent } from './auth-verification-handler/auth-verification-handler.component';
import { FinalizarCadastroComponent } from './finalizar-cadastro/finalizar-cadastro.component';
import { EmailInputModalComponent } from '../email-input-modal/email-input-modal.component';
import { RegisterComponent } from './register.component';

@NgModule({
  declarations: [
    RegisterComponent,
    WelcomeComponent,
    AuthVerificationHandlerComponent,
    FinalizarCadastroComponent
  ],

  imports: [
    CommonModule,
    RouterModule,
    RegisterRoutingModule,
    ReactiveFormsModule,
    FormsModule,
    MatInputModule,
    MatButtonModule,
    MatDialogModule,
    MatCheckboxModule,
    EmailInputModalComponent,
  ],
  exports: [RegisterComponent],
})
export class RegisterModule { }
