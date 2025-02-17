// src\app\user-profile\user-profile-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { UserProfileViewComponent } from './user-profile-view/user-profile-view.component';
import { EditUserProfileComponent } from './user-profile-edit/edit-user-profile/edit-user-profile.component';
import { EditProfilePreferencesComponent } from './user-profile-edit/edit-preferences/edit-profile-preferences.component';
import { EditProfileSocialLinksComponent } from './user-profile-edit/edit-profile-social-links/edit-profile-social-links.component';
import { AuthGuard } from '../core/guards/auth.guard';
import { UserOwnerGuard } from '../core/guards/user.owner.guard';

const routes: Routes = [
  {
    path: ':id',
    component: UserProfileViewComponent,
    canActivate: [AuthGuard, UserOwnerGuard]
  },
  {
    path: ':id/editar-dados-pessoais',
    component: EditUserProfileComponent,
    canActivate: [AuthGuard, UserOwnerGuard]
  },
  {
    path: ':id/edit-profile-preferences',
    component: EditProfilePreferencesComponent,
    canActivate: [AuthGuard, UserOwnerGuard]
  },
  {
    // Nova rota p/ edição de redes sociais
    path: ':id/edit-profile-social-links',
    component: EditProfileSocialLinksComponent,
    canActivate: [AuthGuard, UserOwnerGuard]
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class UserProfileRoutingModule { }
