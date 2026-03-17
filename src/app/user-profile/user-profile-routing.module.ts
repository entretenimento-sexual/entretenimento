// src/app/user-profile/user-profile-routing.module.ts
// Rotas do perfil.
//
// Regras:
// - /perfil -> próprio perfil
// - /perfil/:uid -> visualização do perfil informado
// - rotas de edição ficam acima da rota genérica :uid
// - edição do próprio perfil exige apenas autenticação + ownership
//
// Observação:
// - não usamos mais duplicações inúteis com :id e :uid ao mesmo tempo,
//   porque :uid já cobre o path e evita ambiguidade.
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { UserProfileViewComponent } from './user-profile-view/user-profile-view.component';
import { EditUserProfileComponent } from './user-profile-edit/edit-user-profile/edit-user-profile.component';
import { EditProfilePreferencesComponent } from './user-profile-edit/edit-preferences/edit-profile-preferences.component';
import { EditProfileSocialLinksComponent } from './user-profile-edit/edit-profile-social-links/edit-profile-social-links.component';

import { UserOwnerGuard } from '../core/guards/ownership-guard/user.owner.guard';

const routes: Routes = [
  // ===========================================================================
  // Edição do próprio perfil
  // ===========================================================================
  {
    path: ':uid/editar-dados-pessoais',
    component: EditUserProfileComponent,
    canActivate: [UserOwnerGuard],
  },
  {
    path: ':uid/edit-profile-preferences',
    component: EditProfilePreferencesComponent,
    canActivate: [UserOwnerGuard],
  },
  {
    path: ':uid/edit-profile-social-links',
    component: EditProfileSocialLinksComponent,
    canActivate: [UserOwnerGuard],
  },

  // ===========================================================================
  // Visualização
  // ===========================================================================
  {
    path: '',
    component: UserProfileViewComponent,
    pathMatch: 'full',
  },
  {
    path: ':uid',
    component: UserProfileViewComponent,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class UserProfileRoutingModule { }
