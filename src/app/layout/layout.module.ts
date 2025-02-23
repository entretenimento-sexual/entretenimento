// src/app/layout/layout.module.ts
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProfileListComponent } from './profile-list/profile-list.component';
import { PerfisProximosComponent } from './perfis-proximos/perfis-proximos.component';
import { GeolocationService } from '../core/services/geolocation/geolocation.service';
import { LayoutRoutingModule } from './layout-routing.module';
import { SharedModule } from '../shared/shared.module';

@NgModule({
  declarations: [
    ProfileListComponent,
    PerfisProximosComponent,
  ],

  imports: [
    CommonModule,
    LayoutRoutingModule,
    SharedModule,
  ],

  exports: [
    ProfileListComponent,
    PerfisProximosComponent
  ],
  providers: [GeolocationService]
})
export class LayoutModule { }
