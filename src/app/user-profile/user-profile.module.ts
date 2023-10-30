// src\app\user-profile\user-profile.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { UserProfileViewComponent } from './user-profile-view/user-profile-view.component';
import { SharedModule } from '../shared/shared/shared.module';

const routes: Routes = [
  { path: '', component: UserProfileViewComponent }
];

@NgModule({
  declarations: [UserProfileViewComponent],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    RouterModule.forChild(routes)
  ],
  exports: [UserProfileViewComponent]
})
export class UserProfileModule { }
