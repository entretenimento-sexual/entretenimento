// src/app/header/header.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { NavbarComponent } from './navbar/navbar.component';
import { LogoComponent } from './logo/logo.component';
import { GuestBannerComponent } from './guest-banner/guest-banner.component';
import { GlobalInviteBadgeComponent } from './global-invite-badge/global-invite-badge.component';
import {
  LegalUpdateNoticeBridgeComponent,
} from './legal-update-notice-bridge/legal-update-notice-bridge.component';

import { SharedMaterialModule } from 'src/app/shared/shared-material.module';
import { ImageFallbackDirective } from 'src/app/shared/directives/image-fallback.directive';

@NgModule({
  declarations: [
    NavbarComponent,
    LogoComponent,
    GuestBannerComponent,
  ],
  imports: [
    CommonModule,
    RouterModule,
    SharedMaterialModule,
    ImageFallbackDirective,
    GlobalInviteBadgeComponent,
    LegalUpdateNoticeBridgeComponent,
  ],
  exports: [
    NavbarComponent,
    LogoComponent,
    GlobalInviteBadgeComponent,
    LegalUpdateNoticeBridgeComponent,
  ],
})
export class HeaderModule {}
