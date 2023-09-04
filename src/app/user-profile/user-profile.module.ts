//src\app\user-profile\user-profile.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { UserProfileRoutingModule } from './user-profile-routing.module';
import { UserProfileViewComponent } from './user-profile-view/user-profile-view.component';


@NgModule({
  declarations: [
    UserProfileViewComponent
  ],
  imports: [
    CommonModule,
    UserProfileRoutingModule
  ]
})
export class UserProfileModule { }
