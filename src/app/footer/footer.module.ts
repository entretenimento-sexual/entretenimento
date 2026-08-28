// src/app/footer/footer.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ContactFooterComponent } from './contact-footer/contact-footer.component';
import { CopyrightFooterComponent } from './copyright-footer/copyright-footer.component';
import { LegalFooterComponent } from './legal-footer/legal-footer.component';
import { NavigationFooterComponent } from './navigation-footer/navigation-footer.component';
import { FooterComponent } from './footer/footer.component';
import { AuthenticatedFooterComponent } from './authenticated-footer/authenticated-footer.component';
import { FooterRoutingModule } from './footer-routing.module';

@NgModule({
  declarations: [
    ContactFooterComponent,
    CopyrightFooterComponent,
    LegalFooterComponent,
    NavigationFooterComponent,
    FooterComponent,
    AuthenticatedFooterComponent,
  ],
  imports: [CommonModule, FooterRoutingModule],
  exports: [
    ContactFooterComponent,
    CopyrightFooterComponent,
    LegalFooterComponent,
    NavigationFooterComponent,
    FooterComponent,
    AuthenticatedFooterComponent,
  ],
})
export class FooterModule {}
