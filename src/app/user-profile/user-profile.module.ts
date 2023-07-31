// src\app\user-profile\user-profile.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { UserDetailsComponent } from './user-details/user-details.component';
import { UserEditComponent } from './user-edit/user-edit.component';
import { UserPreferencesComponent } from './user-preferences/user-preferences.component';

import { UserProfileService } from './services-profile/user-profile.service';
import { UserProfileResolve } from './services-profile/user-profile.resolve';

@NgModule({
  declarations: [
    UserDetailsComponent,
    UserEditComponent,
    UserPreferencesComponent
  ],
  imports: [
    CommonModule,
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
  providers: [UserProfileService, UserProfileResolve]
})
export class UserProfileModule { }
