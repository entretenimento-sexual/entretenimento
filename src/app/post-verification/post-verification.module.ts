//src\app\post-verification\post-verification.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { PostVerificationRoutingModule } from './post-verification-routing.module';
import { EmailVerifiedComponent } from './email-verified/email-verified.component';


@NgModule({
  declarations: [
    EmailVerifiedComponent
  ],
  imports: [
    CommonModule,
    PostVerificationRoutingModule
  ],
  exports: [
    EmailVerifiedComponent
  ]
})
export class PostVerificationModule { }
