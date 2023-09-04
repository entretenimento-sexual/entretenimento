//src\app\user-profile\user-profile-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { UserProfileViewComponent } from './user-profile-view/user-profile-view.component';

const routes: Routes = [
  { path: '', component: UserProfileViewComponent }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class UserProfileRoutingModule { }
