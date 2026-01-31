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
/*
Apesar de ainda haver problemas com links de navegação como principal
e meu perfil não navegarem corretamente, precisamos estabelecer
o fluxo de autenticação e registro de usuário,
com navegação forçada ou não em algumas etapas, sempre valorizando
a segurança adequada a vontade, desejo e voluntariedade do usuário,
já pensando nas proximas etapas e na coleta de dados e desejo dos usuários de forma sutil
pra possibilitar que ele esteja sendo aproximado para pessoas ou casais que ele deseja
e que desejem o seu perfil.
Tentando sempre respeitar a privacidade e segurança do usuário.
Copiar o máximo possível das boas práticas do Tinder e Grindr e outros apps de relacionamento,
mas sem perder a identidade própria do nosso app, que é mais sério e focado em relacionamentos reais.
E buscar exemplo nas grandes plataformas de relacionamento e redes sociais
para garantir a segurança e privacidade dos dados dos usuários.
*/
