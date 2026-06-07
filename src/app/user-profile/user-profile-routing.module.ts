// src/app/user-profile/user-profile-routing.module.ts
// -----------------------------------------------------------------------------
// ROTAS DO PERFIL
// -----------------------------------------------------------------------------
//
// Regra definitiva:
//
// - /perfil
//   Abre o perfil do usuário autenticado.
//
// - /perfil/:uid
//   Abre o perfil de outro usuário usando OtherUserProfileViewComponent.
//
// - /perfil/:uid/editar-dados-pessoais
// - /perfil/:uid/edit-profile-preferences
// - /perfil/:uid/edit-profile-social-links
//   Rotas de edição protegidas por ownership.
//
// Motivo:
//
// O perfil próprio usa dados privados/controlados pelo estado autenticado.
// O perfil de outro usuário usa a projeção pública/visível daquele perfil.
//
// Importante:
//
// As rotas de edição precisam ficar ANTES da rota genérica ':uid'.
// Se a rota genérica vier antes, ela engole caminhos de edição.

import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { UserProfileViewComponent } from './user-profile-view/user-profile-view.component';
import { EditUserProfileComponent } from './user-profile-edit/edit-user-profile/edit-user-profile.component';
import { EditProfileSocialLinksComponent } from './user-profile-edit/edit-profile-social-links/edit-profile-social-links.component';

import { UserOwnerGuard } from '../core/guards/ownership-guard/user.owner.guard';
import { emailVerifiedGuard } from '../core/guards/profile-guard/email-verified.guard';
import { profileCompletedGuard } from '../core/guards/profile-guard/profile-completed.guard';

const routes: Routes = [
  {
    path: ':uid/editar-dados-pessoais',
    component: EditUserProfileComponent,
    canActivate: [UserOwnerGuard],
  },
  {
    path: ':uid/edit-profile-preferences',
    loadComponent: () =>
      import('../preferences/pages/preferences-editor/preferences-editor.component')
        .then(m => m.PreferencesEditorComponent),
    canActivate: [UserOwnerGuard],
  },
  {
    path: ':uid/edit-profile-social-links',
    component: EditProfileSocialLinksComponent,
    canActivate: [UserOwnerGuard],
  },

  /**
   * Meu perfil.
   *
   * A navegação principal "Meu Perfil" deve apontar para /perfil.
   */
  {
    path: '',
    component: UserProfileViewComponent,
    pathMatch: 'full',
  },

  /**
   * Perfil de outro usuário.
   *
   * Mantém a URL natural:
   * /perfil/:uid
   *
   * Mas usa o componente correto para perfil alheio.
   */
  {
    path: ':uid',
    loadComponent: () =>
      import('../layout/other-user-profile-view/other-user-profile-view.component')
        .then(c => c.OtherUserProfileViewComponent),
    canActivate: [emailVerifiedGuard, profileCompletedGuard],
    data: {
      requireVerified: true,
      requireProfileCompleted: true,
    },
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class UserProfileRoutingModule {}