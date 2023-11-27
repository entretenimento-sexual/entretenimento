//src\app\user-profile\user-profile-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { UserProfileViewComponent } from './user-profile-view/user-profile-view.component';
import { UserProfileEditComponent } from './user-profile-edit/user-profile-edit.component';
import { EditUserProfileComponent } from './user-profile-edit/edit-user-profile/edit-user-profile.component';
import { EditProfilePreferencesComponent } from './user-profile-edit/edit-profile-preferences/edit-profile-preferences.component';

const routes: Routes = [

  { path: ':id', component: UserProfileViewComponent }, // Rota para visualizar o perfil
  { path: ':id/editar', component: UserProfileEditComponent }, // Rota para editar o perfil
  { path: ':id/editar-dados-pessoais', component: EditUserProfileComponent },
  { path: ':id/edit-profile-preferences', component: EditProfilePreferencesComponent }

];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class UserProfileRoutingModule { }
