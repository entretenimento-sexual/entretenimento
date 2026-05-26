// src/app/header/header.module.ts
// Não esquecer de atualizar o caminho do import do SharedMaterialModule se necessário.
// Este módulo é responsável por agrupar os componentes relacionados ao cabeçalho da aplicação, como a barra de navegação e o banner para convidados. Ele importa o CommonModule para funcionalidades comuns do Angular, o RouterModule para navegação e o SharedMaterialModule para componentes de UI compartilhados. Os componentes NavbarComponent e LogoComponent são exportados para serem usados em outros módulos da aplicação.
// Importante: Certifique-se de que os caminhos dos imports estejam corretos de acordo com a estrutura do seu projeto.
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { NavbarComponent } from './navbar/navbar.component';
import { LogoComponent } from './logo/logo.component';
import { GuestBannerComponent } from './guest-banner/guest-banner.component';

import { SharedMaterialModule } from 'src/app/shared/shared-material.module';

@NgModule({
  declarations: [
    NavbarComponent,
    LogoComponent,
    GuestBannerComponent,
  ],
  imports: [
    CommonModule,
    RouterModule,
    SharedMaterialModule,
  ],
  exports: [
    NavbarComponent,
    LogoComponent,
  ],
})
export class HeaderModule {}