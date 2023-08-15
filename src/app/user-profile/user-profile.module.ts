// src\app\user-profile\user-profile.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { UserDetailsComponent } from './user-details/user-details.component';
import { UserEditComponent } from './user-edit/user-edit.component';
import { UserPreferencesComponent } from './user-preferences/user-preferences.component';

import { UserProfileService } from './services-profile/user-profile.service';
import { UserProfileResolve } from './services-profile/user-profile.resolve';
import { AngularFirestoreModule } from '@angular/fire/compat/firestore';
import { UserPhotosComponent } from './user-photos/user-photos.component';

@NgModule({
  declarations: [
    UserDetailsComponent,
    UserEditComponent,
    UserPreferencesComponent,
    UserPhotosComponent
  ],
  imports: [
    CommonModule,
    AngularFirestoreModule,
    RouterModule.forChild([
      {
        path: '',
        component: UserDetailsComponent,
        resolve: { profile: UserProfileResolve }
      },
      {
        path: 'edit',
        component: UserEditComponent,
      },
      {
        path: 'preferences',
        component: UserPreferencesComponent,
      },
    ])
  ],
  providers: [UserProfileService, UserProfileResolve],
  exports: [UserDetailsComponent] // Exporte o UserDetailsComponent para que ele possa ser usado em outros módulos
})
export class UserProfileModule { }
