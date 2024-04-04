//src\app\post-verification\post-verification-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { EmailVerifiedComponent } from './email-verified/email-verified.component';

const routes: Routes = [
  { path: 'email-verified', component: EmailVerifiedComponent }

];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class PostVerificationRoutingModule { }
