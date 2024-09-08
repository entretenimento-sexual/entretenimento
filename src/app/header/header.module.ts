// src\app\header\header.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { NavbarComponent } from './navbar/navbar.component';
import { LogoComponent } from './logo/logo.component';
import { GuestBannerComponent } from './guest-banner/guest-banner.component';
import { LinksInteractionComponent } from './links-interaction/links-interaction.component';

@NgModule({
  declarations: [
    NavbarComponent,
    LogoComponent,
    GuestBannerComponent,
    LinksInteractionComponent
  ],
  imports: [
    CommonModule,
    RouterModule
  ],
  exports: [
    NavbarComponent,
    LogoComponent,
    GuestBannerComponent
  ]
})
export class HeaderModule { }
