// src/app/user-profile/user-profile.module.ts
// Módulo lazy do perfil do usuário.
//
// Propósito:
// - concentrar visualização e edição do próprio perfil
// - permanecer acessível ao usuário autenticado mesmo em etapas de onboarding,
//   para que ele possa corrigir/ajustar dados sem ser travado pelo fluxo
//
// Observação:
// - a proteção principal de acesso ao módulo é feita no AppRouting
// - este módulo não deve assumir por conta própria que o usuário já está
//   com e-mail verificado ou perfil 100% completo
import { NgModule } from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { SharedModule } from '../shared/shared.module';
import { UserProfileRoutingModule } from './user-profile-routing.module';
import { LayoutModule } from '../layout/layout.module';

import { EditProfileRegionComponent } from './user-profile-edit/edit-region/edit-profile-region.component';
import { EditProfileSocialLinksComponent } from './user-profile-edit/edit-profile-social-links/edit-profile-social-links.component';
import { EditUserProfileComponent } from './user-profile-edit/edit-user-profile/edit-user-profile.component';

import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';

@NgModule({
  declarations: [
    EditProfileRegionComponent,
    EditProfileSocialLinksComponent,
    EditUserProfileComponent,
  ],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    ReactiveFormsModule,
    NgOptimizedImage,
    UserProfileRoutingModule,
    LayoutModule,
    MatCardModule,
    MatButtonModule,
    MatExpansionModule,
  ],
})
export class UserProfileModule {}