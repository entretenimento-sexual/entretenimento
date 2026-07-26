// src/app/dashboard/dashboard.module.ts
import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { EffectsModule } from '@ngrx/effects';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';

import { DashboardLayoutComponent } from './dashboard-layout/dashboard-layout.component';
import { DASHBOARD_FEATURE_EFFECTS } from './dashboard-feature.effects';
import { DashboardRoutingModule } from './dashboard-routing.module';
import { FeaturedProfilesComponent } from './featured-profiles/featured-profiles.component';

@NgModule({
  declarations: [
    DashboardLayoutComponent,
    FeaturedProfilesComponent,
  ],
  imports: [
    CommonModule,
    DashboardRoutingModule,
    RouterModule,
    NgbModule,
    EffectsModule.forFeature(DASHBOARD_FEATURE_EFFECTS),
  ],
})
export class DashboardModule {}
