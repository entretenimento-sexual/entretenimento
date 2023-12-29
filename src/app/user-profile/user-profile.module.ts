// src\app\user-profile\user-profile.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { UserProfileViewComponent } from './user-profile-view/user-profile-view.component';
import { SharedModule } from '../shared/shared.module';
import { UserProfileRoutingModule } from './user-profile-routing.module';
import { EditProfileRegionComponent } from './user-profile-edit/edit-profile-region/edit-profile-region.component';
import { EditProfilePreferencesComponent } from './user-profile-edit/edit-profile-preferences/edit-profile-preferences.component';
import { EditProfileSocialLinksComponent } from './user-profile-edit/edit-profile-social-links/edit-profile-social-links.component';
import { EditUserProfileComponent } from './user-profile-edit/edit-user-profile/edit-user-profile.component';
import { LayoutModule } from '../layout/layout.module';

@NgModule({
  declarations: [UserProfileViewComponent, EditProfileRegionComponent,
                 EditProfilePreferencesComponent, EditProfileSocialLinksComponent,
                 EditUserProfileComponent],

  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    ReactiveFormsModule,
    UserProfileRoutingModule,
    LayoutModule

  ]
})
export class UserProfileModule { }
