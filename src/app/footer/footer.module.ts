// src\app\footer\footer.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ContactFooterComponent } from './contact-footer/contact-footer.component';
import { CopyrightFooterComponent } from './copyright-footer/copyright-footer.component';
import { LegalFooterComponent } from './legal-footer/legal-footer.component';
import { NavigationFooterComponent } from './navigation-footer/navigation-footer.component';
import { SocialFooterComponent } from './social-footer/social-footer.component';
import { FooterComponent } from './footer/footer.component';

@NgModule({
  declarations: [
    ContactFooterComponent,
    CopyrightFooterComponent,
    LegalFooterComponent,
    NavigationFooterComponent,
    SocialFooterComponent,
    FooterComponent
  ],
  imports: [
    CommonModule
  ],
  exports: [
    ContactFooterComponent,
    CopyrightFooterComponent,
    LegalFooterComponent,
    NavigationFooterComponent,
    SocialFooterComponent,
    FooterComponent
  ]
})
export class FooterModule { }
