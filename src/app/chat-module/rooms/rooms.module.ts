// src/app/chat-module/rooms/rooms.module.ts
// Não esquecer de exportar os componentes que serão usados fora do módulo,
// e de importar os módulos necessários para os componentes funcionarem.

import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { RoomsRoutingModule } from './rooms-routing.module';

import { RoomListComponent } from './room-list/room-list.component';
import { RoomDetailsComponent } from './room-details/room-details.component';
import { RoomCreationComponent } from './room-creation/room-creation.component';

import { RoomService } from 'src/app/core/services/batepapo/room-services/room.service';

@NgModule({
  declarations: [
    RoomListComponent,
    RoomDetailsComponent,
    RoomCreationComponent,
  ],

  imports: [
    CommonModule,
    RoomsRoutingModule,
  ],

  exports: [
    RoomListComponent,
    RoomDetailsComponent,
    RoomCreationComponent,
  ],

  providers: [
    RoomService,
  ],
})
export class RoomsModule {}
