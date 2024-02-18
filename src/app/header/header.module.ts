// src\app\header\header.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';  // Importe o RouterModule aqui
import { NavbarComponent } from './navbar/navbar.component';
import { LogoComponent } from './logo/logo.component';
import { GuestBannerComponent } from './guest-banner/guest-banner.component';

@NgModule({
  declarations: [
    NavbarComponent,
    LogoComponent,
    GuestBannerComponent
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
