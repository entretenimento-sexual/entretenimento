// src\app\user-profile\user-profile.module.ts
import { NgModule } from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import { FormsModule, ReactiveFormsModule, NgForm } from '@angular/forms';
import { SharedModule } from '../shared/shared.module';
import { UserProfileRoutingModule } from './user-profile-routing.module';
import { EditProfileRegionComponent } from './user-profile-edit/edit-region/edit-profile-region.component';
import { EditProfilePreferencesComponent } from './user-profile-edit/edit-preferences/edit-profile-preferences.component';
import { EditProfileSocialLinksComponent } from './user-profile-edit/edit-profile-social-links/edit-profile-social-links.component';
import { EditUserProfileComponent } from './user-profile-edit/edit-user-profile/edit-user-profile.component';
import { LayoutModule } from '../layout/layout.module';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';

@NgModule({
    declarations: [
      EditProfileRegionComponent,
      EditProfilePreferencesComponent,
      EditProfileSocialLinksComponent,
      EditUserProfileComponent,
   ],

    imports: [
        CommonModule,
        FormsModule,
        SharedModule,
        ReactiveFormsModule,
        NgOptimizedImage,
        UserProfileRoutingModule,
        LayoutModule,
        MatCardModule,
        MatButtonModule,
        MatExpansionModule,
    ],

})
export class UserProfileModule { }
