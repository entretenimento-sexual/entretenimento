// src\app\footer\footer.module.ts
// Não esquecer comentários explicativos e ferramentas de debug
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ContactFooterComponent } from './contact-footer/contact-footer.component';
import { CopyrightFooterComponent } from './copyright-footer/copyright-footer.component';
import { LegalFooterComponent } from './legal-footer/legal-footer.component';
import { NavigationFooterComponent } from './navigation-footer/navigation-footer.component';
import { FooterComponent } from './footer/footer.component';
import { FooterRoutingModule } from './footer-routing.module';

@NgModule({
  declarations: [
    ContactFooterComponent,
    CopyrightFooterComponent,
    LegalFooterComponent,
    NavigationFooterComponent,
    FooterComponent,
  ],
  imports: [
    CommonModule,
    FooterRoutingModule,
  ],
  exports: [
    ContactFooterComponent,
    CopyrightFooterComponent,
    LegalFooterComponent,
    NavigationFooterComponent,
    FooterComponent,
  ],
})
export class FooterModule {}
