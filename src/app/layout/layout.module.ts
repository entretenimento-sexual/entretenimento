// src/app/layout/layout.module.ts
// Módulo de layout.
// Responsabilidades desta fase:
// - declarar o LayoutShellComponent
// - manter componentes estruturais de layout
// - importar header e shared para o shell autenticado
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { ProfileListComponent } from './profile-list/profile-list.component';

import { GeolocationService } from '../core/services/geolocation/geolocation.service';
import { LayoutRoutingModule } from './layout-routing.module';
import { SharedModule } from '../shared/shared.module';
import { HeaderModule } from '../header/header.module';

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
  ],

  exports: [
    ProfileListComponent,

  ],

  providers: [GeolocationService]
})
export class LayoutModule { }
