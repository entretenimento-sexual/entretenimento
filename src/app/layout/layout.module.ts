// src\app\core\layout\layout.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { UserProfileModule } from '../user-profile/user-profile.module'; // Importe o módulo de perfil do usuário aqui

import { MainLayoutComponent } from './main-layout/main-layout.component';
import { ErrorPageComponent } from './error-page/error-page.component';

@NgModule({
  declarations: [
    MainLayoutComponent,
    ErrorPageComponent
  ],
  imports: [
    CommonModule,
    UserProfileModule // Adicione o módulo de perfil do usuário às importações
  ],
  exports: [
    MainLayoutComponent,
    ErrorPageComponent
  ]
})
export class LayoutModule { }
