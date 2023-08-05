// src\app\app-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { UserDetailsComponent } from './user-profile/user-details/user-details.component';
import { UserProfileResolve } from './user-profile/services-profile/user-profile.resolve';

const routes: Routes = [
  {
    path: 'user-profile/:userId',
    component: UserDetailsComponent,
    resolve: { userProfile: UserProfileResolve }
  },
  // outras rotas do seu aplicativo...
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
