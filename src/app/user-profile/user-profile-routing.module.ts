//src\app\user-profile\user-profile-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { UserProfileViewComponent } from './user-profile-view/user-profile-view.component';
import { EditUserProfileComponent } from './user-profile-edit/edit-user-profile/edit-user-profile.component';
import { EditProfilePreferencesComponent } from './user-profile-edit/edit-profile-preferences/edit-profile-preferences.component';
import { UserPhotoGalleryComponent } from './user-profile-view/user-photo-gallery/user-photo-gallery.component';
import { AuthGuard } from '../core/guards/auth.guard';
import { UserOwnerGuard } from '../core/guards/user.owner.guard';

const routes: Routes = [
  { path: ':id', component: UserProfileViewComponent, canActivate: [AuthGuard, UserOwnerGuard] }, // Rota para visualizar o perfil
  { path: ':id/editar-dados-pessoais', component: EditUserProfileComponent, canActivate: [AuthGuard, UserOwnerGuard] },
  { path: ':id/edit-profile-preferences', component: EditProfilePreferencesComponent, canActivate: [AuthGuard, UserOwnerGuard] },
  { path: ':id/fotos', component: UserPhotoGalleryComponent, canActivate: [AuthGuard, UserOwnerGuard] },

];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class UserProfileRoutingModule { }
