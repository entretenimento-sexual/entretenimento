// src/app/user-profile/user-profile-routing.module.ts
// -----------------------------------------------------------------------------
// ROTAS DO PERFIL
// -----------------------------------------------------------------------------
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { UserProfileViewComponent } from './user-profile-view/user-profile-view.component';
import { EditUserProfileComponent } from './user-profile-edit/edit-user-profile/edit-user-profile.component';
import { EditProfileSocialLinksComponent } from './user-profile-edit/edit-profile-social-links/edit-profile-social-links.component';

import { UserOwnerGuard } from '../core/guards/ownership-guard/user.owner.guard';
import { emailVerifiedGuard } from '../core/guards/profile-guard/email-verified.guard';
import { profileCompletedGuard } from '../core/guards/profile-guard/profile-completed.guard';
import { unsavedChangesGuard } from '../core/guards/unsaved-changes/unsaved-changes.guard';

const routes: Routes = [
  {
    path: ':uid/editar-dados-pessoais',
    component: EditUserProfileComponent,
    canActivate: [UserOwnerGuard],
    canDeactivate: [unsavedChangesGuard],
  },
  {
    path: ':uid/edit-profile-preferences',
    loadComponent: () =>
      import('../preferences/pages/preferences-editor/preferences-editor.component')
        .then((module) => module.PreferencesEditorComponent),
    canActivate: [UserOwnerGuard],
  },
  {
    path: ':uid/edit-profile-social-links',
    component: EditProfileSocialLinksComponent,
    canActivate: [UserOwnerGuard],
  },
  {
    path: '',
    component: UserProfileViewComponent,
    pathMatch: 'full',
  },
  {
    path: ':uid',
    loadComponent: () =>
      import('../layout/other-user-profile-view/other-user-profile-view.component')
        .then((component) => component.OtherUserProfileViewComponent),
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
