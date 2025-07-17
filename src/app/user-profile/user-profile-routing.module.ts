// src\app\user-profile\user-profile-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { UserProfileViewComponent } from './user-profile-view/user-profile-view.component';
import { EditUserProfileComponent } from './user-profile-edit/edit-user-profile/edit-user-profile.component';
import { EditProfilePreferencesComponent } from './user-profile-edit/edit-preferences/edit-profile-preferences.component';
import { EditProfileSocialLinksComponent } from './user-profile-edit/edit-profile-social-links/edit-profile-social-links.component';
import { authGuard } from '../core/guards/auth.guard';
import { UserOwnerGuard } from '../core/guards/user.owner.guard';

const routes: Routes = [
  {
    path: ':id',
    component: UserProfileViewComponent,
    canActivate: [authGuard, UserOwnerGuard]
  },
  {
    path: ':id/editar-dados-pessoais',
    component: EditUserProfileComponent,
    canActivate: [authGuard, UserOwnerGuard]
  },
  {
    path: ':id/edit-profile-preferences',
    component: EditProfilePreferencesComponent,
    canActivate: [authGuard, UserOwnerGuard]
  },
  {
    // Nova rota p/ edição de redes sociais
    path: ':id/edit-profile-social-links',
    component: EditProfileSocialLinksComponent,
    canActivate: [authGuard, UserOwnerGuard]
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class UserProfileRoutingModule { }
