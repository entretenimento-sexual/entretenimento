// src/app/core/footer/footer.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ContactFooterComponent } from './contact-footer/contact-footer.component';
import { CopyrightFooterComponent } from './copyright-footer/copyright-footer.component';
import { FooterComponent } from './footer/footer.component';
import { LegalFooterComponent } from './legal-footer/legal-footer.component';
import { NavigationFooterComponent } from './navigation-footer/navigation-footer.component';
import { SocialFooterComponent } from './social-footer/social-footer.component';

@NgModule({
  declarations: [
    ContactFooterComponent,
    CopyrightFooterComponent,
    FooterComponent,
    LegalFooterComponent,
    NavigationFooterComponent,
    SocialFooterComponent
  ],
  imports: [
    CommonModule
  ],
  exports: [
    FooterComponent
  ]
})
export class FooterModule { }
