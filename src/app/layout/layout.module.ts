// src/app/layout/layout.module.ts
// Módulo de layout.
// Responsabilidades desta fase:
// - declarar componentes estruturais de layout
// - importar header e shared para o shell autenticado
// - manter o fluxo legado de perfis próximos isolado do bootstrap global
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { EffectsModule } from '@ngrx/effects';

import { ProfileListComponent } from './profile-list/profile-list.component';
import { GeolocationService } from '../core/services/geolocation/geolocation.service';
import { LayoutRoutingModule } from './layout-routing.module';
import { SharedModule } from '../shared/shared.module';
import { HeaderModule } from '../header/header.module';
import { LAYOUT_FEATURE_EFFECTS } from './layout-feature.effects';

@NgModule({
  declarations: [
    ProfileListComponent,
  ],

  imports: [
    CommonModule,
    RouterModule,
    LayoutRoutingModule,
    SharedModule,
    HeaderModule,
    EffectsModule.forFeature(LAYOUT_FEATURE_EFFECTS),
  ],

  exports: [
    ProfileListComponent,
  ],

  providers: [GeolocationService]
})
export class LayoutModule { }
